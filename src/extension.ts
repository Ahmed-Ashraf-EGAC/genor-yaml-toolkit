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
            // Create a new document for multi-line template input
            const newDoc = await vscode.workspace.openTextDocument({
                content: `# Enter your YAML template below:\n# Example:\nmy_agent:\n  name: My Agent\n  type: agent\n  inputs:\n    agent_path: "path.to.agent"\n  outputs:\n    - output`,
                language: 'yaml'
            });

            await vscode.window.showTextDocument(newDoc);

            const result = await vscode.window.showInformationMessage(
                'Edit the template in the opened document, then click "Save Template" when ready.',
                'Save Template',
                'Cancel'
            );

            if (result === 'Save Template') {
                const currentEditor = vscode.window.activeTextEditor;
                if (currentEditor && currentEditor.document === newDoc) {
                    templateContent = currentEditor.document.getText();
                    // Remove the comment lines
                    templateContent = templateContent
                        .split('\n')
                        .filter(line => !line.trim().startsWith('#'))
                        .join('\n')
                        .trim();
                }

                // Close the temporary document
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            } else {
                // Close the temporary document
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                return;
            }
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