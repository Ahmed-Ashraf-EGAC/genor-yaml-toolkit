import * as vscode from 'vscode';
import * as path from 'path';

let lastClickTime = 0;
let linkClearTimeout: NodeJS.Timeout | undefined;

function registerDocumentLinkProvider() {
    const documentLinkProvider = vscode.languages.registerDocumentLinkProvider('yaml', {
        provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
            const links: vscode.DocumentLink[] = [];

            // Clear links for a short period after clicking
            const now = Date.now();
            if (now - lastClickTime < 500) { // 500ms cooldown after click
                return links;
            }

            // Get the current cursor position to determine what word is being hovered
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== document) {
                return links;
            }

            const position = editor.selection.active;
            const wordRange = document.getWordRangeAtPosition(position);

            if (!wordRange) {
                return links;
            }

            const hoveredWord = document.getText(wordRange);
            const line = document.lineAt(position.line);
            const lineText = line.text;

            // Patterns to match node names that can be searched
            const nodePatterns = [
                /^(\s*-\s*)(\w+)\s*$/gm, // next: references (capture the node name)
                /^(\s*)(\w+):\s*/gm, // node definitions
                /{{(\s*)(\w+)(\.outputs)/gm // output references
            ];

            // Check if the hovered word matches any of our patterns on the current line
            for (const pattern of nodePatterns) {
                pattern.lastIndex = 0; // Reset regex
                let match;

                while ((match = pattern.exec(lineText)) !== null) {
                    let nodeName: string;
                    let startIndex: number;

                    if (pattern.source.includes('{{')) {
                        // For output references like {{node.outputs}}
                        nodeName = match[2];
                        startIndex = match.index + match[1].length;
                    } else if (pattern.source.includes('-\\s*')) {
                        // For next: references like "- nodeName"
                        nodeName = match[2];
                        startIndex = match.index + match[1].length;
                    } else {
                        // For node definitions like "nodeName:"
                        nodeName = match[2];
                        startIndex = match.index + match[1].length;
                    }

                    // Only create a link if this matches the currently hovered word
                    if (nodeName === hoveredWord) {
                        // Create range for the node name
                        const startPos = new vscode.Position(position.line, startIndex);
                        const endPos = new vscode.Position(position.line, startIndex + nodeName.length);
                        const range = new vscode.Range(startPos, endPos);

                        // Create a document link with a custom command
                        const link = new vscode.DocumentLink(range);
                        link.target = vscode.Uri.parse(`command:genor-yaml-toolkit.findAllDefinitions`);
                        link.tooltip = `Find all definitions of "${nodeName}"`;

                        links.push(link);
                        break; // Only need one link for the hovered word
                    }
                }
            }

            return links;
        }
    });

    return documentLinkProvider;
}

// Modified activateLanguageFeatures function to include click handling
export function activateLanguageFeatures() {
    // Helper function to filter out combined_graph files
    function filterCombinedGraphFiles(files: vscode.Uri[]): vscode.Uri[] {
        return files.filter(fileUri => {
            const fileName = path.basename(fileUri.fsPath).toLowerCase();
            return !fileName.includes('combined_graph');
        });
    }

    // Register definition provider that searches across all files
    const definitionProvider = vscode.languages.registerDefinitionProvider('yaml', {
        async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return undefined;
            }

            const word = document.getText(wordRange);

            // First, search for node definition in current document
            const nodeDefinitionRegex = new RegExp(`^\\s*${word}:\\s*`);

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                if (nodeDefinitionRegex.test(line)) {
                    return new vscode.Location(document.uri, new vscode.Position(i, line.indexOf(word)));
                }
            }

            // If not found in current document, search across all YAML files
            try {
                const allYamlFiles = await vscode.workspace.findFiles('**/*.{yml,yaml}', '**/node_modules/**');
                const yamlFiles = filterCombinedGraphFiles(allYamlFiles);
                const definitions: vscode.Location[] = [];

                for (const fileUri of yamlFiles) {
                    // Skip current document as we already searched it
                    if (fileUri.toString() === document.uri.toString()) {
                        continue;
                    }

                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);

                        for (let i = 0; i < doc.lineCount; i++) {
                            const line = doc.lineAt(i).text;
                            if (nodeDefinitionRegex.test(line)) {
                                definitions.push(new vscode.Location(
                                    doc.uri,
                                    new vscode.Position(i, line.indexOf(word))
                                ));
                            }
                        }
                    } catch (err) {
                        console.error(`Error processing file ${fileUri.toString()}: ${err}`);
                    }
                }

                // Return the first definition found, or all if multiple
                if (definitions.length === 1) {
                    return definitions[0];
                } else if (definitions.length > 1) {
                    return definitions;
                }
            } catch (err) {
                console.error(`Error searching for definitions: ${err}`);
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

    // Register the document link provider for clickable node names
    const documentLinkProvider = registerDocumentLinkProvider();

    // Register command for finding references across all files
    const findAllReferencesCommand = vscode.commands.registerCommand('genor-yaml-toolkit.findAllReferences', async () => {
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


    return [definitionProvider, referencesProvider, documentLinkProvider, findAllReferencesCommand];
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

            // Find all YAML files in the workspace and filter out combined_graph files
            const allYamlFiles = await vscode.workspace.findFiles('**/*.{yml,yaml}', '**/node_modules/**');
            const yamlFiles = allYamlFiles.filter(fileUri => {
                const fileName = path.basename(fileUri.fsPath).toLowerCase();
                return !fileName.includes('combined_graph');
            });

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
