import * as vscode from 'vscode';

export function activateLanguageFeatures() {
    // Register definition provider
    const definitionProvider = vscode.languages.registerDefinitionProvider('yaml', {
        provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return undefined;
            }

            const word = document.getText(wordRange);

            // Only search for node definition
            const nodeDefinitionRegex = new RegExp(`^\\s*${word}:\\s*$`);

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                if (nodeDefinitionRegex.test(line)) {
                    return new vscode.Location(document.uri, new vscode.Position(i, 0));
                }
            }

            return undefined;
        }
    });

    // Register references provider
    const referencesProvider = vscode.languages.registerReferenceProvider('yaml', {
        provideReferences(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] {
            const references: vscode.Location[] = [];
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                throw new Error('No references found');
            }

            const word = document.getText(wordRange);

            // Search for references in 'next' sections, node definitions, and output references
            const referencePatterns = [
                new RegExp(`^\\s*-\\s*${word}\\s*$`), // next: references
                new RegExp(`^\\s*${word}:\\s*`), // node definitions or references in outputs
                new RegExp(`{{\\s*${word}\\.outputs`), // output references
            ];

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                for (const pattern of referencePatterns) {
                    if (pattern.test(line)) {
                        references.push(new vscode.Location(
                            document.uri,
                            new vscode.Position(i, line.indexOf(word))
                        ));
                    }
                }
            }

            if (references.length === 1) {
                throw new Error(`No references found for node "${word}"`);
            }

            return references;
        }
    });

    // Register command for finding references across all files
    const findAllReferencesCommand = vscode.commands.registerCommand('yaml-formatter.findAllReferences', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'yaml') {
            vscode.window.showErrorMessage('This command only works in YAML files');
            return;
        }

        const position = editor.selection.active;
        const wordRange = editor.document.getWordRangeAtPosition(position);
        if (!wordRange) {
            vscode.window.showErrorMessage('No word selected');
            return;
        }

        const word = editor.document.getText(wordRange);
        await findReferencesAcrossFiles(word);
    });

    return [definitionProvider, referencesProvider, findAllReferencesCommand];
}

/**
 * Find references to a node across all YAML files in the workspace
 * @param nodeName The name of the node to find references for
 */
async function findReferencesAcrossFiles(nodeName: string): Promise<void> {
    // Show progress indicator
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Finding references to "${nodeName}" across files...`,
        cancellable: true
    }, async (progress, token) => {
        try {
            // Create patterns to search for
            const patterns = [
                `^\\s*-\\s*${nodeName}\\s*$`, // next: references
                `^\\s*${nodeName}:\\s*`, // node definitions or references in outputs
                `{{\\s*${nodeName}\\.outputs` // output references
            ];

            // Create search query with OR conditions
            const searchQuery = patterns.join('|');

            // Find all YAML files in the workspace
            const yamlFiles = await vscode.workspace.findFiles('**/*.{yml,yaml}', '**/node_modules/**');

            // Create a references array to store all found references
            const allReferences: vscode.Location[] = [];

            // Calculate total files for progress reporting
            const totalFiles = yamlFiles.length;
            let filesProcessed = 0;

            // Process each file
            for (const fileUri of yamlFiles) {
                if (token.isCancellationRequested) {
                    break;
                }

                // Update progress bar with percentage
                filesProcessed++;
                const progressPercentage = (filesProcessed / totalFiles) * 100;
                progress.report({
                    increment: 100 / totalFiles,
                    message: `${Math.round(progressPercentage)}% complete`
                });

                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);

                    // Search for references in this document
                    for (let i = 0; i < document.lineCount; i++) {
                        const line = document.lineAt(i).text;
                        for (const pattern of patterns) {
                            const regex = new RegExp(pattern);
                            if (regex.test(line)) {
                                allReferences.push(new vscode.Location(
                                    document.uri,
                                    new vscode.Position(i, line.indexOf(nodeName))
                                ));
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error processing file ${fileUri.toString()}: ${err}`);
                }
            }

            // Show results in the references panel
            if (allReferences.length > 0) {
                vscode.commands.executeCommand('editor.action.showReferences',
                    vscode.window.activeTextEditor?.document.uri,
                    vscode.window.activeTextEditor?.selection.active || new vscode.Position(0, 0),
                    allReferences
                );
            } else {
                vscode.window.showInformationMessage(`No references found for "${nodeName}" across files`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Error finding references: ${err}`);
        }
    });
}