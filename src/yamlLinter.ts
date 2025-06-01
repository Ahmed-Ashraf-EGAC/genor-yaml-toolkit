
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
        collection.set(document.uri, lintErrors.map(convertLintErrorToDiagnostic));
        return;
    }

    // Track used node references for circular dependency check
    const nodeReferences = new Set<string>();
    const definedNodes = new Set<string>();

    // Validate nodes recursively
    lintErrors.push(...validateNodes(nodes, document, nodeReferences, definedNodes));

    // Check for unresolved references
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

function validateNodes(
    nodes: YAMLMap,
    document: vscode.TextDocument,
    nodeReferences: Set<string>,
    definedNodes: Set<string>,
    parentNodeName?: string
): LintError[] {
    const lintErrors: LintError[] = [];

    for (const pair of nodes.items) {
        const nodeKey = pair.key;
        const nodeValue = pair.value;

        // Get the node name as string
        const nodeName = typeof nodeKey === 'string' ? nodeKey : String(nodeKey);
        const fullNodeName = parentNodeName ? `${parentNodeName}.${nodeName}` : nodeName;
        definedNodes.add(fullNodeName);

        // Find the line number for this node
        const lineNo = findNodeLine(document, nodeName);

        // Skip if we couldn't find the line
        if (lineNo === -1) {
            continue;
        }

        // Check if nodeValue is a valid object with proper structure
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

            // Always check for nested nodes if there's a subgraph structure
            // This ensures we validate nested nodes even if the parent node has issues
            const hasGetMethod = 'get' in nodeValue && typeof (nodeValue as any).get === 'function';
            const inputs = hasGetMethod ? (nodeValue as any).get('inputs') : (nodeValue as any)['inputs'];

            if (inputs) {
                const inputsHasGet = inputs && typeof inputs === 'object' && 'get' in inputs && typeof inputs.get === 'function';
                const subgraph = inputsHasGet ? inputs.get('subgraph') : inputs['subgraph'];

                if (subgraph) {
                    const subgraphHasGet = subgraph && typeof subgraph === 'object' && 'get' in subgraph && typeof subgraph.get === 'function';
                    const nestedNodes = subgraphHasGet ? subgraph.get('nodes') : subgraph['nodes'];

                    if (nestedNodes && nestedNodes instanceof YAMLMap) {
                        // Recursively validate nested nodes
                        lintErrors.push(...validateNodes(nestedNodes, document, nodeReferences, definedNodes, nodeName));
                    }
                }
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

    return lintErrors;
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

    // Get the node type first with proper type checking
    const hasGetMethod = node && typeof node === 'object' && 'get' in node && typeof node.get === 'function';
    const nodeType = hasGetMethod ? node.get('type') : node['type'];

    // If no type is specified, skip validation
    if (!nodeType) {
        return errors;
    }

    // Define required fields for each node type
    const requiredFieldsByType: { [key: string]: string[] } = {
        'agent': ['type', 'name', "inputs", "outputs"],
        'ifelse': ['type', 'name', "conditions"],
        'aggregator': ['type', 'name', 'outputs'],
        'iterator': ['type', 'name', 'inputs'],
        'while': ['type', 'name', 'inputs'],
    };

    const requiredFields = requiredFieldsByType[nodeType.toString().toLowerCase()];

    // If node type is not recognized, only check for basic fields
    if (!requiredFields) {
        errors.push(createLintError(
            line, 0,
            `Node "${nodeName}" has unknown type: ${nodeType}`,
            vscode.DiagnosticSeverity.Warning
        ));
        return errors;
    }

    // Check each required field for this node type
    requiredFields.forEach(field => {
        const value = hasGetMethod ? node.get(field) : node[field];

        // Check if the field exists and has a non-empty value
        if (value === undefined || value === null ||
            (typeof value === 'string' && value.trim() === '') ||
            (value && typeof value === 'object' && value.toString && value.toString().trim() === '')) {
            errors.push(createLintError(
                line, 0,
                `Node "${nodeName}" of type "${nodeType}" is missing required field: ${field}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    });

    // Additional validation for agent types
    const nodeTypeStr = nodeType.toString().toLowerCase();
    if (nodeTypeStr === 'agent') {
        const inputs = hasGetMethod ? node.get('inputs') : node['inputs'];
        if (inputs) {
            const inputsHasGet = inputs && typeof inputs === 'object' && 'get' in inputs && typeof inputs.get === 'function';

            // Get agent_path to determine if init_kwargs should be checked
            const agentPath = inputsHasGet ? inputs.get('agent_path') : inputs['agent_path'];
            const agentPathStr = agentPath ? agentPath.toString() : '';

            // Agents that don't require init_kwargs
            const agentsWithoutInitKwargs = [
                'genor_agents.custom_smart_judge_agents.identity_agent.IdentityAgent',
                'genor_agents.information_extraction.ocrs.pdf_ocr_agent.PDFOCRAgent'
            ];

            const skipInitKwargs = agentsWithoutInitKwargs.includes(agentPathStr);

            // Check required agent input fields
            const requiredAgentFields = skipInitKwargs ? ['agent_path'] : ['agent_path', 'init_kwargs'];
            requiredAgentFields.forEach(field => {
                const value = inputsHasGet ? inputs.get(field) : inputs[field];

                // For agent_path, check if it's empty string as well
                const isEmpty = field === 'agent_path'
                    ? (!value || (typeof value === 'string' && value.trim() === ''))
                    : !value;

                if (isEmpty) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}" of type "${nodeType}" is missing required field: inputs.${field}`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            });

            // Check for either call_kwargs or call_args (they are equivalent)
            const callKwargs = inputsHasGet ? inputs.get('call_kwargs') : inputs['call_kwargs'];
            const callArgs = inputsHasGet ? inputs.get('call_args') : inputs['call_args'];

            if (!callKwargs && !callArgs) {
                errors.push(createLintError(
                    line, 0,
                    `Node "${nodeName}" of type "${nodeType}" is missing required field: inputs.call_kwargs`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    // Additional validation for iterator and while types
    if (nodeTypeStr === 'iterator' || nodeTypeStr === 'while') {
        const inputs = hasGetMethod ? node.get('inputs') : node['inputs'];
        if (inputs) {
            const inputsHasGet = inputs && typeof inputs === 'object' && 'get' in inputs && typeof inputs.get === 'function';

            // Check for iterable field in iterators
            if (nodeTypeStr === 'iterator') {
                const iterable = inputsHasGet ? inputs.get('iterable') : inputs['iterable'];
                if (!iterable || (typeof iterable === 'string' && iterable.trim() === '')) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}" of type "${nodeType}" is missing required field: inputs.iterable`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }

            const subgraph = inputsHasGet ? inputs.get('subgraph') : inputs['subgraph'];
            if (!subgraph) {
                errors.push(createLintError(
                    line, 0,
                    `Node "${nodeName}" of type "${nodeType}" is missing required field: inputs.subgraph`,
                    vscode.DiagnosticSeverity.Error
                ));
            } else {
                const subgraphHasGet = subgraph && typeof subgraph === 'object' && 'get' in subgraph && typeof subgraph.get === 'function';
                const nestedNodes = subgraphHasGet ? subgraph.get('nodes') : subgraph['nodes'];
                if (!nestedNodes) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}" of type "${nodeType}" is missing required field: inputs.subgraph.nodes`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
        }
    }

    // Additional validation for ifelse types
    if (nodeTypeStr === 'ifelse') {
        const conditions = hasGetMethod ? node.get('conditions') : node['conditions'];
        if (conditions) {
            // Check if conditions is an array/sequence
            const isArray = Array.isArray(conditions) ||
                (conditions && typeof conditions === 'object' && 'items' in conditions);

            if (isArray) {
                let hasIfCondition = false;

                // Handle YAML sequence (YAMLSeq) or regular array
                const conditionsArray = Array.isArray(conditions) ? conditions :
                    (conditions.items ? conditions.items : []);

                for (const condition of conditionsArray) {
                    const conditionHasGet = condition && typeof condition === 'object' && 'get' in condition && typeof condition.get === 'function';
                    const ifField = conditionHasGet ? condition.get('if') : condition['if'];

                    if (ifField) {
                        hasIfCondition = true;
                        break;
                    }
                }

                if (!hasIfCondition) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}" of type "${nodeType}" is missing required field: conditions.if`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            } else {
                errors.push(createLintError(
                    line, 0,
                    `Node "${nodeName}" of type "${nodeType}" has invalid conditions structure - should be an array`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    return errors;
}

function checkDataTypes(node: any, nodeName: string, line: number): LintError[] {
    const errors: LintError[] = [];

    // Get outputs field
    const outputs = node.get ? node.get('outputs') : node.outputs;

    // Check if outputs exists and is valid
    if (outputs !== undefined) {
        // Check if outputs is null (happens when YAML has "outputs:" with no value)
        if (outputs === null) {
            errors.push(createLintError(
                line, 0,
                `Node "${nodeName}": 'outputs' field is empty`,
                vscode.DiagnosticSeverity.Error
            ));
        } else {
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
            } else {
                // Check if outputs is empty or contains only empty items
                let isEmpty = false;
                let hasEmptyItems = false;

                if (isRegularArray) {
                    isEmpty = outputs.length === 0;
                    hasEmptyItems = outputs.some(item =>
                        item === null || item === undefined ||
                        (typeof item === 'string' && item.trim() === '') ||
                        item === '-'
                    );
                } else if (isYAMLArray) {
                    isEmpty = !outputs.items || outputs.items.length === 0;
                    hasEmptyItems = outputs.items && outputs.items.some((item: any) => {
                        // Handle different YAML node types
                        let value: unknown;

                        if (item && typeof item === 'object') {
                            // Check if it's a YAML scalar node
                            if ('value' in item) {
                                value = item.value;
                            } else if ('toString' in item && typeof item.toString === 'function') {
                                const stringValue = item.toString();
                                value = stringValue;
                            } else {
                                value = item;
                            }
                        } else {
                            value = item;
                        }

                        return value === null || value === undefined ||
                            (typeof value === 'string' && (value.trim() === '' || value === '-')) ||
                            value === '';
                    });
                }

                if (isEmpty) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}": 'outputs' field is empty`,
                        vscode.DiagnosticSeverity.Error
                    ));
                } else if (hasEmptyItems) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}": 'outputs' field contains empty items`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
        }
    }

    // Get next field
    const next = node.get ? node.get('next') : node.next;

    // Check if next exists and is valid
    if (next !== undefined) {
        // Check if next is null (happens when YAML has "next:" with no value)
        if (next === null) {
            errors.push(createLintError(
                line, 0,
                `Node "${nodeName}": 'next' field is empty`,
                vscode.DiagnosticSeverity.Error
            ));
            // Continue processing instead of returning early
        } else {
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
            } else {
                // Check if next is empty or contains empty items
                let isEmpty = false;
                let hasEmptyItems = false;

                if (isString) {
                    isEmpty = next.trim() === '' || next === '-';
                } else if (isRegularArray) {
                    isEmpty = next.length === 0;
                    hasEmptyItems = next.some(item =>
                        item === null || item === undefined ||
                        (typeof item === 'string' && (item.trim() === '' || item === '-'))
                    );
                } else if (isYAMLArray) {
                    isEmpty = !next.items || next.items.length === 0;
                    hasEmptyItems = next.items && next.items.some((item: any) => {
                        // Handle different YAML node types
                        let value: unknown;

                        if (item && typeof item === 'object') {
                            // Check if it's a YAML scalar node
                            if ('value' in item) {
                                value = item.value;
                            } else if ('toString' in item && typeof item.toString === 'function') {
                                const stringValue = item.toString();
                                value = stringValue;
                            } else {
                                value = item;
                            }
                        } else {
                            value = item;
                        }

                        return value === null || value === undefined ||
                            (typeof value === 'string' && (value.trim() === '' || value === '-')) ||
                            value === '';
                    });
                }

                if (isEmpty) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}": 'next' field is empty`,
                        vscode.DiagnosticSeverity.Error
                    ));
                } else if (hasEmptyItems) {
                    errors.push(createLintError(
                        line, 0,
                        `Node "${nodeName}": 'next' field contains empty items`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
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
