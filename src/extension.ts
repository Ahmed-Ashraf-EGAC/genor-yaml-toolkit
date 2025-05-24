import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { agentTemplates } from './agentTemplates';
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

    let addAgentCommand = vscode.commands.registerCommand('genor-yaml-toolkit.addAgent', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'yaml') {
            return;
        }

        const selection = await vscode.window.showQuickPick(
            agentTemplates.map(t => t.name),
            {
                placeHolder: 'Select an agent template'
            }
        );

        if (!selection) {
            return;
        }

        const template = agentTemplates.find(t => t.name === selection)?.template;
        if (!template) {
            return;
        }

        // Get the current indentation level
        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);
        const currentIndent = line.text.match(/^\s*/)?.[0] || '';

        // Indent the template
        const indentedTemplate = template
            .split('\n')
            .map(line => currentIndent + line)
            .join('\n');

        await editor.edit(editBuilder => {
            editBuilder.insert(position, indentedTemplate + '\n');
        });
    });

    context.subscriptions.push(addAgentCommand);

    let insertAgentCommand = vscode.commands.registerCommand('genor-yaml-toolkit.insertAgent', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'yaml') {
            return;
        }

        // Simplified quick pick that only shows names
        const selection = await vscode.window.showQuickPick(
            agentTemplates.map(t => t.name),
            {
                placeHolder: 'Select an agent template'
            }
        );

        if (!selection) {
            return;
        }

        const template = agentTemplates.find(t => t.name === selection)?.template;
        if (!template) {
            return;
        }

        // Get current indentation and insert template
        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);
        const currentIndent = line.text.match(/^\s*/)?.[0] || '';

        const indentedTemplate = template
            .split('\n')
            .map((line, index) => {
                // Don't indent the first line (agent name)
                if (index === 0) {
                    return line;
                }
                // Indent all other lines
                return currentIndent + line;
            })
            .join('\n');

        await editor.edit(editBuilder => {
            editBuilder.insert(position, indentedTemplate + '\n');
        });
    });

    context.subscriptions.push(insertAgentCommand);

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
