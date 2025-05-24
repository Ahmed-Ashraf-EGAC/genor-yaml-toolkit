
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

    const diagnostics: vscode.Diagnostic[] = [];
    let doc: Document.Parsed;

    try {
        doc = parseDocument(document.getText());
    } catch (e: any) {
        diagnostics.push(new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            `YAML Syntax Error: ${e.message}`,
            vscode.DiagnosticSeverity.Error
        ));
        collection.set(document.uri, diagnostics);
        return;
    }

    const nodes = doc.get('nodes');
    if (!nodes || !(nodes instanceof YAMLMap)) {
        diagnostics.push(createDiagnostic(0, 0, "Missing or invalid 'nodes' section", vscode.DiagnosticSeverity.Error));
        collection.set(document.uri, diagnostics);
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
            checkRequiredFields(nodeValue, nodeName, lineNo, diagnostics);

            // Check data types
            checkDataTypes(nodeValue, nodeName, lineNo, diagnostics);

            // Check for empty values
            checkEmptyValues(nodeValue, nodeName, lineNo, diagnostics);

            // Collect node references
            collectNodeReferences(nodeValue, nodeReferences);

            // Check indentation
            checkIndentation(document, lineNo, diagnostics);
        } else {
            // Node value is not an object
            diagnostics.push(createDiagnostic(
                lineNo, 0,
                `Node "${nodeName}" has invalid structure`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // 3. Check for unresolved references
    nodeReferences.forEach(ref => {
        if (!definedNodes.has(ref)) {
            diagnostics.push(createDiagnostic(
                0, 0,
                `Unresolved node reference: ${ref}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    });

    // Set new diagnostics
    collection.set(document.uri, diagnostics);
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

function checkRequiredFields(node: any, nodeName: string, line: number, diagnostics: vscode.Diagnostic[]) {
    const requiredFields = ['type', 'name'];

    requiredFields.forEach(field => {
        // Get the value using get method if available (for YAML nodes)
        const value = node.get ? node.get(field) : node[field];

        // Check if the field exists and has a non-empty value
        if (value === undefined || value === null || value.toString().trim() === '') {
            diagnostics.push(createDiagnostic(
                line, 0,
                `Node "${nodeName}" is missing required field: ${field}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    });
}

function checkDataTypes(node: any, nodeName: string, line: number, diagnostics: vscode.Diagnostic[]) {
    // Get outputs field
    const outputs = node.get ? node.get('outputs') : node.outputs;

    // Check if outputs exists and is valid
    if (outputs !== undefined) {
        // Check if it's a YAMLSeq (YAML's array representation)
        const isYAMLArray = outputs && typeof outputs === 'object' && outputs.items !== undefined;
        // Check if it's a regular array
        const isRegularArray = Array.isArray(outputs);

        if (!isYAMLArray && !isRegularArray && typeof outputs !== 'object') {
            diagnostics.push(createDiagnostic(
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
            diagnostics.push(createDiagnostic(
                line, 0,
                `Node "${nodeName}": 'next' must be an array or string`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }
}

function checkEmptyValues(node: any, nodeName: string, line: number, diagnostics: vscode.Diagnostic[]) {
    // For YAML nodes, we need to iterate differently
    if (node.items) {
        // It's a YAMLMap
        for (const pair of node.items) {
            const key = pair.key;
            const value = pair.value;

            if (value === null || value === undefined || value === '') {
                diagnostics.push(createDiagnostic(
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
                diagnostics.push(createDiagnostic(
                    line, 0,
                    `Node "${nodeName}": '${key}' has empty value`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        });
    }
}

function checkIndentation(document: vscode.TextDocument, line: number, diagnostics: vscode.Diagnostic[]) {
    if (line < 0 || line >= document.lineCount) {
        return;
    }

    const lineText = document.lineAt(line).text;
    const indentMatch = lineText.match(/^(\s+)/);
    if (indentMatch && (indentMatch[1].includes('\t') && indentMatch[1].includes(' '))) {
        diagnostics.push(createDiagnostic(
            line, 0,
            "Mixed tab and space indentation",
            vscode.DiagnosticSeverity.Warning
        ));
    }
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

function createDiagnostic(
    line: number,
    character: number,
    message: string,
    severity: vscode.DiagnosticSeverity
): vscode.Diagnostic {
    return new vscode.Diagnostic(
        new vscode.Range(
            line,
            character,
            line,
            character + 1
        ),
        message,
        severity
    );
}
