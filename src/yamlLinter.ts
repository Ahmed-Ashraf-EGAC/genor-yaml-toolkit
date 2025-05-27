
import * as vscode from 'vscode';
import { parseDocument, Document, Node, YAMLMap, Pair } from 'yaml';

interface LintError {
    message: string;
    severity: vscode.DiagnosticSeverity;
    range: vscode.Range;
}

// Create a single static diagnostic collection
const collection = vscode.languages.createDiagnosticCollection('yaml-lint');

export function lintYaml(document: vscode.TextDocument) {
    // Clear diagnostics for this document
    collection.delete(document.uri);

    const lintErrors: LintError[] = [];
    let doc: Document.Parsed;

    try {
        doc = parseDocument(document.getText());
    } catch (e: any) {
        lintErrors.push({
            message: `YAML Syntax Error: ${e.message}`,
            severity: vscode.DiagnosticSeverity.Error,
            range: new vscode.Range(0, 0, 0, 1)
        });
        collection.set(document.uri, lintErrors.map(convertLintErrorToDiagnostic));
        return;
    }

    const nodes = doc.get('nodes');
    if (!nodes || !(nodes instanceof YAMLMap)) {
        lintErrors.push(createLintError(0, 0, "Missing or invalid 'nodes' section", vscode.DiagnosticSeverity.Error));
        collection.set(document.uri, lintErrors.map(convertLintErrorToDiagnostic));
        return;
    }

    // Track used node references for circular dependency check
    const nodeReferences = new Set<string>();
    const definedNodes = new Set<string>();

    // 2. Check each node
    for (const pair of nodes.items) {
        const nodeKey = pair.key;
        const nodeValue = pair.value;

        // Get the node name as string
        const nodeName = typeof nodeKey === 'string' ? nodeKey : String(nodeKey);
        definedNodes.add(nodeName);

        // Find the line number for this node
        const lineNo = findNodeLine(document, nodeName);

        // Skip if we couldn't find the line
        if (lineNo === -1) {
            continue;
        }

        // Check if nodeValue is a YAMLMap
        if (nodeValue && typeof nodeValue === 'object') {
            // Check required fields
            lintErrors.push(...checkRequiredFields(nodeValue, nodeName, lineNo));

            // Check data types
            lintErrors.push(...checkDataTypes(nodeValue, nodeName, lineNo));

            // Check for empty values
            lintErrors.push(...checkEmptyValues(nodeValue, nodeName, lineNo));

            // Collect node references
            collectNodeReferences(nodeValue, nodeReferences);

            // Check indentation
            const indentationError = checkIndentation(document, lineNo);
            if (indentationError) {
                lintErrors.push(indentationError);
            }
        } else {
            // Node value is not an object
            lintErrors.push(createLintError(
                lineNo, 0,
                `Node "${nodeName}" has invalid structure`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // 3. Check for unresolved references
    nodeReferences.forEach(ref => {
        if (!definedNodes.has(ref)) {
            lintErrors.push(createLintError(
                0, 0,
                `Unresolved node reference: ${ref}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    });

    // Convert LintErrors to Diagnostics and set them
    collection.set(document.uri, lintErrors.map(convertLintErrorToDiagnostic));
}

function collectNodeReferences(node: any, nodeReferences: Set<string>) {
    if (!node) return;

    const next = node.get ? node.get('next') : node.next;

    if (next) {
        if (Array.isArray(next)) {
            next.forEach(n => {
                if (typeof n === 'string') {
                    nodeReferences.add(n);
                }
            });
        } else if (typeof next === 'string') {
            nodeReferences.add(next);
        }
    }
}

function checkRequiredFields(node: any, nodeName: string, line: number): LintError[] {
    const errors: LintError[] = [];
    const requiredFields = ['type', 'name'];

    requiredFields.forEach(field => {
        // Get the value using get method if available (for YAML nodes)
        const value = node.get ? node.get(field) : node[field];

        // Check if the field exists and has a non-empty value
        if (value === undefined || value === null || value.toString().trim() === '') {
            errors.push(createLintError(
                line, 0,
                `Node "${nodeName}" is missing required field: ${field}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    });

    return errors;
}

function checkDataTypes(node: any, nodeName: string, line: number): LintError[] {
    const errors: LintError[] = [];

    // Get outputs field
    const outputs = node.get ? node.get('outputs') : node.outputs;

    // Check if outputs exists and is valid
    if (outputs !== undefined) {
        // Check if it's a YAMLSeq (YAML's array representation)
        const isYAMLArray = outputs && typeof outputs === 'object' && outputs.items !== undefined;
        // Check if it's a regular array
        const isRegularArray = Array.isArray(outputs);

        if (!isYAMLArray && !isRegularArray && typeof outputs !== 'object') {
            errors.push(createLintError(
                line, 0,
                `Node "${nodeName}": 'outputs' must be an array or object`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // Get next field
    const next = node.get ? node.get('next') : node.next;

    // Check if next exists and is valid
    if (next !== undefined) {
        // Check if it's a YAMLSeq (YAML's array representation)
        const isYAMLArray = next && typeof next === 'object' && next.items !== undefined;
        // Check if it's a regular array
        const isRegularArray = Array.isArray(next);
        // Check if it's a string
        const isString = typeof next === 'string';

        if (!isYAMLArray && !isRegularArray && !isString) {
            errors.push(createLintError(
                line, 0,
                `Node "${nodeName}": 'next' must be an array or string`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    return errors;
}

function checkEmptyValues(node: any, nodeName: string, line: number): LintError[] {
    const errors: LintError[] = [];

    // For YAML nodes, we need to iterate differently
    if (node.items) {
        // It's a YAMLMap
        for (const pair of node.items) {
            const key = pair.key;
            const value = pair.value;

            if (value === null || value === undefined || value === '') {
                errors.push(createLintError(
                    line, 0,
                    `Node "${nodeName}": '${key}' has empty value`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    } else {
        // Regular object
        Object.entries(node).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') {
                errors.push(createLintError(
                    line, 0,
                    `Node "${nodeName}": '${key}' has empty value`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        });
    }

    return errors;
}

function checkIndentation(document: vscode.TextDocument, line: number): LintError | null {
    if (line < 0 || line >= document.lineCount) {
        return null;
    }

    const lineText = document.lineAt(line).text;
    const indentMatch = lineText.match(/^(\s+)/);
    if (indentMatch && (indentMatch[1].includes('\t') && indentMatch[1].includes(' '))) {
        return createLintError(
            line, 0,
            "Mixed tab and space indentation",
            vscode.DiagnosticSeverity.Warning
        );
    }

    return null;
}

function createLintError(
    line: number,
    character: number,
    message: string,
    severity: vscode.DiagnosticSeverity
): LintError {
    return {
        message,
        severity,
        range: new vscode.Range(
            line,
            character,
            line,
            character + 1
        )
    };
}

function convertLintErrorToDiagnostic(lintError: LintError): vscode.Diagnostic {
    return new vscode.Diagnostic(
        lintError.range,
        lintError.message,
        lintError.severity
    );
}

function findNodeLine(document: vscode.TextDocument, nodeName: string): number {
    const text = document.getText();
    const lines = text.split('\n');

    // Look for the node definition pattern
    const nodePattern = new RegExp(`^\\s*${escapeRegExp(nodeName)}\\s*:`, 'm');

    // First look in the nodes section
    let inNodesSection = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if we're entering the nodes section
        if (/^\s*nodes\s*:/.test(line)) {
            inNodesSection = true;
            continue;
        }

        // If we're in the nodes section and find a match, return the line number
        if (inNodesSection && nodePattern.test(line)) {
            return i;
        }

        // If we encounter a new top-level section, we're no longer in the nodes section
        if (inNodesSection && /^\w+\s*:/.test(line)) {
            inNodesSection = false;
        }
    }

    // If not found in nodes section, search the entire document
    for (let i = 0; i < lines.length; i++) {
        if (nodePattern.test(lines[i])) {
            return i;
        }
    }

    return -1;
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
