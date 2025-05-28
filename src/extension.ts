import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { agentTemplates, TemplateManager } from './agentTemplates';
import { activateLanguageFeatures } from './yamlLanguageConfiguration';
import { lintYaml } from './yamlLinter';

function extractPromptBlocks(text: string): { modifiedText: string; blocks: string[] } {
    const lines = text.split(/\r?\n/);
    const blocks: string[] = [];
    const modifiedLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const promptMatch = line.match(/^(\s*)prompt:\s*>\s*$/);
        if (promptMatch) {
            const baseIndent = promptMatch[1];
            const originalBlockLines = [line];
            i++;
            // Collect all lines that are indented more than the prompt line's indent,
            // or are blank (preserve them as part of the block)
            while (i < lines.length) {
                const currentLine = lines[i];
                if (currentLine.trim() === '') {
                    originalBlockLines.push(currentLine);
                    i++;
                    continue;
                }
                const currentIndentMatch = currentLine.match(/^(\s*)/);
                if (currentIndentMatch && currentIndentMatch[1].length > baseIndent.length) {
                    originalBlockLines.push(currentLine);
                    i++;
                } else {
                    break;
                }
            }
            const originalBlock = originalBlockLines.join('\n');
            const placeholder = `${baseIndent}prompt: "@@PROMPT_BLOCK_${blocks.length}@@"`;
            blocks.push(originalBlock);
            modifiedLines.push(placeholder);
        } else {
            modifiedLines.push(line);
            i++;
        }
    }
    return { modifiedText: modifiedLines.join('\n'), blocks };
}

/**
 * Restores placeholders with the original prompt blocks.
 * Looks for lines matching: {indent}prompt: "@@PROMPT_BLOCK_{index}@@"
 * and replaces them with the original block.
 */
function restorePromptBlocks(formattedText: string, blocks: string[]): string {
    return formattedText.replace(
        /^(?<indent>\s*)prompt:\s*"@@PROMPT_BLOCK_(\d+)@@"\s*$/gm,
        (match, indent, index) => {
            const originalBlock = blocks[Number(index)];
            return originalBlock;
        }
    );
}

export function activate(context: vscode.ExtensionContext) {
    const templateManager = new TemplateManager(context);

    let disposable = vscode.commands.registerCommand('genor-yaml-toolkit.formatYaml', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'yaml') {
            const config = vscode.workspace.getConfiguration('genorYamlToolkit');

            const indent = config.get<number>('indentation', 2);
            const lineWidth = config.get<number>('wrapLines', -1);

            const originalText = editor.document.getText();
            const { modifiedText, blocks } = extractPromptBlocks(originalText);

            try {
                const doc = parseDocument(modifiedText);

                const formattedYaml = doc.toString({
                    indent,
                    lineWidth
                });

                const finalYaml = restorePromptBlocks(formattedYaml, blocks);

                await editor.edit(editBuilder => {
                    const fullRange = new vscode.Range(
                        editor.document.positionAt(0),
                        editor.document.positionAt(originalText.length)
                    );
                    editBuilder.replace(fullRange, finalYaml);
                });
            } catch (error) {
                vscode.window.showErrorMessage("Invalid YAML format.");
            }
        }
    });

    context.subscriptions.push(disposable);

    let insertAgentCommand = vscode.commands.registerCommand('genor-yaml-toolkit.insertAgent', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'yaml') {
            return;
        }

        // Get all templates (built-in + custom)
        const allTemplates = templateManager.getAllTemplates(agentTemplates);

        // Create quick pick items with indicators for custom templates
        const quickPickItems = allTemplates.map(template => ({
            label: template.name,
            description: template.isCustom ? '(Custom)' : '(Built-in)',
            template: template.template
        }));

        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select an agent template'
        });

        if (!selection) {
            return;
        }

        // Get current indentation and insert template
        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);
        const currentIndent = line.text.match(/^\s*/)?.[0] || '';

        // Properly format the template with preserved line breaks
        const templateLines = selection.template.split('\n');
        const indentedTemplate = templateLines
            .map((templateLine, index) => {
                // Don't indent the first line if it starts at the beginning
                if (index === 0 && templateLine.match(/^\S/)) {
                    return currentIndent + templateLine;
                }
                // For subsequent lines, preserve their relative indentation
                return currentIndent + templateLine;
            })
            .join('\n');

        await editor.edit(editBuilder => {
            editBuilder.insert(position, indentedTemplate + '\n');
        });
    });

    context.subscriptions.push(insertAgentCommand);

    // Command to create a new custom template
    let createTemplateCommand = vscode.commands.registerCommand('genor-yaml-toolkit.createTemplate', async () => {
        const editor = vscode.window.activeTextEditor;

        // Get template name from user
        const templateName = await vscode.window.showInputBox({
            prompt: 'Enter a name for your custom template',
            placeHolder: 'My Custom Agent',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Template name cannot be empty';
                }
                // Check if name already exists
                const existingTemplates = templateManager.getAllTemplates(agentTemplates);
                if (existingTemplates.some(t => t.name === value.trim())) {
                    return 'A template with this name already exists';
                }
                return null;
            }
        });

        if (!templateName) {
            return;
        }

        let templateContent = '';

        // If there's an active editor with selected text, use it as template
        if (editor && editor.document.languageId === 'yaml' && !editor.selection.isEmpty) {
            templateContent = editor.document.getText(editor.selection);
        } else {
            // Create a webview panel for template input
            const panel = vscode.window.createWebviewPanel(
                'templateEditor',
                'Create Template',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            const defaultTemplate = `my_agent:
  name: My Agent
  type: agent
  inputs:
    agent_path: "path.to.agent"
  outputs:
    - output`;

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { 
                            font-family: 'Courier New', monospace; 
                            margin: 20px; 
                            background-color: var(--vscode-editor-background);
                            color: var(--vscode-editor-foreground);
                        }
                        textarea { 
                            width: 100%; 
                            height: 400px; 
                            font-family: 'Courier New', monospace; 
                            font-size: 14px;
                            border: 1px solid var(--vscode-input-border);
                            padding: 10px;
                            background-color: var(--vscode-input-background);
                            color: var(--vscode-input-foreground);
                            resize: vertical;
                            tab-size: 2;
                        }
                        button { 
                            margin: 10px 5px; 
                            padding: 10px 20px; 
                            font-size: 14px;
                            border: none;
                            cursor: pointer;
                        }
                        .save-btn { 
                            background-color: var(--vscode-button-background); 
                            color: var(--vscode-button-foreground); 
                        }
                        .save-btn:hover {
                            background-color: var(--vscode-button-hoverBackground);
                        }
                        .cancel-btn { 
                            background-color: var(--vscode-button-secondaryBackground); 
                            color: var(--vscode-button-secondaryForeground); 
                        }
                        .cancel-btn:hover {
                            background-color: var(--vscode-button-secondaryHoverBackground);
                        }
                        h3 {
                            color: var(--vscode-foreground);
                        }
                    </style>
                </head>
                <body>
                    <h3>Enter your YAML template:</h3>
                    <textarea id="templateContent" placeholder="Enter your YAML template here...">${defaultTemplate}</textarea>
                    <br>
                    <button class="save-btn" onclick="saveTemplate()">Save Template</button>
                    <button class="cancel-btn" onclick="cancelTemplate()">Cancel</button>
                    
                    <script>
                        const vscode = acquireVsCodeApi();
                        
                        // Undo/Redo history management
                        let undoStack = [];
                        let redoStack = [];
                        let lastValue = '';
                        
                        const textarea = document.getElementById('templateContent');
                        
                        // Initialize undo stack
                        function saveState() {
                            if (textarea.value !== lastValue) {
                                undoStack.push({
                                    value: lastValue,
                                    selectionStart: textarea.selectionStart,
                                    selectionEnd: textarea.selectionEnd
                                });
                                if (undoStack.length > 50) { // Limit undo stack size
                                    undoStack.shift();
                                }
                                redoStack = []; // Clear redo stack when new action is performed
                                lastValue = textarea.value;
                            }
                        }
                        
                        // Initialize
                        lastValue = textarea.value;
                        
                        // Save state on input
                        textarea.addEventListener('input', function() {
                            setTimeout(saveState, 0);
                        });
                        
                        // Handle keyboard shortcuts and tab indentation
                        textarea.addEventListener('keydown', function(e) {
                            // Handle Ctrl+Z (Undo)
                            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                                e.preventDefault();
                                if (undoStack.length > 0) {
                                    const state = undoStack.pop();
                                    redoStack.push({
                                        value: textarea.value,
                                        selectionStart: textarea.selectionStart,
                                        selectionEnd: textarea.selectionEnd
                                    });
                                    textarea.value = state.value;
                                    textarea.selectionStart = state.selectionStart;
                                    textarea.selectionEnd = state.selectionEnd;
                                    lastValue = textarea.value;
                                }
                                return;
                            }
                            
                            // Handle Ctrl+Y (Redo)
                            if (e.ctrlKey && e.key === 'y') {
                                e.preventDefault();
                                if (redoStack.length > 0) {
                                    const state = redoStack.pop();
                                    undoStack.push({
                                        value: textarea.value,
                                        selectionStart: textarea.selectionStart,
                                        selectionEnd: textarea.selectionEnd
                                    });
                                    textarea.value = state.value;
                                    textarea.selectionStart = state.selectionStart;
                                    textarea.selectionEnd = state.selectionEnd;
                                    lastValue = textarea.value;
                                }
                                return;
                            }
                            
                            // Handle Tab and Shift+Tab
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                saveState(); // Save state before modification
                                
                                const start = textarea.selectionStart;
                                const end = textarea.selectionEnd;
                                const value = textarea.value;
                                
                                if (e.shiftKey) {
                                    // Shift+Tab: Remove indentation
                                    if (start === end) {
                                        // No selection, handle current line
                                        const lineStart = value.lastIndexOf('\\n', start - 1) + 1;
                                        const lineEnd = value.indexOf('\\n', start);
                                        const actualLineEnd = lineEnd === -1 ? value.length : lineEnd;
                                        const line = value.substring(lineStart, actualLineEnd);
                                        
                                        if (line.startsWith('  ')) {
                                            // Remove 2 spaces
                                            textarea.value = value.substring(0, lineStart) + line.substring(2) + value.substring(actualLineEnd);
                                            textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - 2);
                                        } else if (line.startsWith(' ')) {
                                            // Remove 1 space
                                            textarea.value = value.substring(0, lineStart) + line.substring(1) + value.substring(actualLineEnd);
                                            textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - 1);
                                        }
                                    } else {
                                        // Selection exists, unindent all selected lines
                                        const beforeSelection = value.substring(0, start);
                                        const selectedText = value.substring(start, end);
                                        const afterSelection = value.substring(end);
                                        
                                        const lines = selectedText.split('\\n');
                                        const unindentedLines = lines.map(line => {
                                            if (line.startsWith('  ')) {
                                                return line.substring(2);
                                            } else if (line.startsWith(' ')) {
                                                return line.substring(1);
                                            }
                                            return line;
                                        });
                                        
                                        const unindentedText = unindentedLines.join('\\n');
                                        textarea.value = beforeSelection + unindentedText + afterSelection;
                                        
                                        // Maintain selection
                                        textarea.selectionStart = start;
                                        textarea.selectionEnd = start + unindentedText.length;
                                    }
                                } else {
                                    // Tab: Add indentation
                                    if (start === end) {
                                        // No selection, just insert 2 spaces
                                        textarea.value = value.substring(0, start) + '  ' + value.substring(end);
                                        textarea.selectionStart = textarea.selectionEnd = start + 2;
                                    } else {
                                        // Selection exists, indent all selected lines
                                        const beforeSelection = value.substring(0, start);
                                        const selectedText = value.substring(start, end);
                                        const afterSelection = value.substring(end);
                                        
                                        const lines = selectedText.split('\\n');
                                        const indentedLines = lines.map(line => '  ' + line);
                                        const indentedText = indentedLines.join('\\n');
                                        
                                        textarea.value = beforeSelection + indentedText + afterSelection;
                                        
                                        // Maintain selection
                                        textarea.selectionStart = start;
                                        textarea.selectionEnd = start + indentedText.length;
                                    }
                                }
                                
                                lastValue = textarea.value;
                            }
                        });
                        
                        function saveTemplate() {
                            const content = document.getElementById('templateContent').value;
                            vscode.postMessage({
                                command: 'saveTemplate',
                                content: content
                            });
                        }
                        
                        function cancelTemplate() {
                            vscode.postMessage({
                                command: 'cancelTemplate'
                            });
                        }
                    </script>
                </body>
                </html>
            `;

            // Handle messages from the webview
            const messagePromise = new Promise<string | null>((resolve) => {
                panel.webview.onDidReceiveMessage(message => {
                    switch (message.command) {
                        case 'saveTemplate':
                            resolve(message.content);
                            panel.dispose();
                            break;
                        case 'cancelTemplate':
                            resolve(null);
                            panel.dispose();
                            break;
                    }
                });

                // Handle panel disposal
                panel.onDidDispose(() => {
                    resolve(null);
                });
            });

            templateContent = await messagePromise || '';
        }

        if (!templateContent || templateContent.trim().length === 0) {
            vscode.window.showWarningMessage('Template content cannot be empty');
            return;
        }

        try {
            await templateManager.saveCustomTemplate(templateName.trim(), templateContent);
            vscode.window.showInformationMessage(`Custom template "${templateName}" saved successfully!`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save template: ${error}`);
        }
    });

    context.subscriptions.push(createTemplateCommand);

    // Command to manage custom templates
    let manageTemplatesCommand = vscode.commands.registerCommand('genor-yaml-toolkit.manageTemplates', async () => {
        const customTemplates = templateManager.getCustomTemplates();

        if (customTemplates.length === 0) {
            vscode.window.showInformationMessage('No custom templates found. Create one first!');
            return;
        }

        const quickPickItems = customTemplates.map(template => ({
            label: template.name,
            description: `Created: ${new Date(template.createdAt).toLocaleDateString()}`,
            detail: 'Click to delete this template',
            template: template
        }));

        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a custom template to delete'
        });

        if (!selection) {
            return;
        }

        const confirmDelete = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the template "${selection.template.name}"?`,
            'Delete',
            'Cancel'
        );

        if (confirmDelete === 'Delete') {
            try {
                await templateManager.deleteCustomTemplate(selection.template.id);
                vscode.window.showInformationMessage(`Template "${selection.template.name}" deleted successfully!`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete template: ${error}`);
            }
        }
    });

    context.subscriptions.push(manageTemplatesCommand);

    // Add language features
    const languageFeatures = activateLanguageFeatures();
    context.subscriptions.push(...languageFeatures);

    let lintCommand = vscode.commands.registerCommand('genor-yaml-toolkit.lintYaml', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'yaml') {
            lintYaml(editor.document);
        }
    });

    context.subscriptions.push(lintCommand);

    // Add automatic linting on save
    let diagnosticsSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === 'yaml') {
            lintYaml(document);
        }
    });

    context.subscriptions.push(diagnosticsSubscription);
}

export function deactivate() { }