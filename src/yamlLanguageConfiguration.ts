import * as vscode from 'vscode';

export function activateLanguageFeatures() {
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
                const yamlFiles = await vscode.workspace.findFiles('**/*.{yml,yaml}', '**/node_modules/**');
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

    // Register command for finding definitions across all files
    const findAllDefinitionsCommand = vscode.commands.registerCommand('genor-yaml-toolkit.findAllDefinitions', async () => {
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
        await findDefinitionsAcrossFiles(word);
    });

    return [definitionProvider, referencesProvider, findAllReferencesCommand, findAllDefinitionsCommand];
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

/**
 * Find definitions of a node across all YAML files in the workspace
 * @param nodeName The name of the node to find definitions for
 */
async function findDefinitionsAcrossFiles(nodeName: string): Promise<void> {
    // Show progress indicator
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Finding definitions of "${nodeName}" across files...`,
        cancellable: true
    }, async (progress, token) => {
        try {
            // Pattern to search for node definitions (node name followed by colon)
            const definitionPattern = `^\\s*${nodeName}:\\s*`;

            // Find all YAML files in the workspace
            const yamlFiles = await vscode.workspace.findFiles('**/*.{yml,yaml}', '**/node_modules/**');

            // Create a definitions array to store all found definitions
            const allDefinitions: vscode.Location[] = [];

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

                    // Search for definitions in this document
                    for (let i = 0; i < document.lineCount; i++) {
                        const line = document.lineAt(i).text;
                        const regex = new RegExp(definitionPattern);
                        if (regex.test(line)) {
                            allDefinitions.push(new vscode.Location(
                                document.uri,
                                new vscode.Position(i, line.indexOf(nodeName))
                            ));
                        }
                    }
                } catch (err) {
                    console.error(`Error processing file ${fileUri.toString()}: ${err}`);
                }
            }

            // Show results
            if (allDefinitions.length > 0) {
                if (allDefinitions.length === 1) {
                    // If only one definition found, navigate directly to it
                    const definition = allDefinitions[0];
                    const document = await vscode.workspace.openTextDocument(definition.uri);
                    const editor = await vscode.window.showTextDocument(document);
                    editor.selection = new vscode.Selection(definition.range.start, definition.range.start);
                    editor.revealRange(definition.range, vscode.TextEditorRevealType.InCenter);
                } else {
                    // If multiple definitions found, show them in the references panel
                    vscode.commands.executeCommand('editor.action.showReferences',
                        vscode.window.activeTextEditor?.document.uri,
                        vscode.window.activeTextEditor?.selection.active || new vscode.Position(0, 0),
                        allDefinitions
                    );
                }
            } else {
                vscode.window.showInformationMessage(`No definitions found for "${nodeName}" across files`);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Error finding definitions: ${err}`);
        }
    });
}