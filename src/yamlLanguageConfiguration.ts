import * as vscode from 'vscode';

export function activateLanguageFeatures() {
    // Register definition provider
    const definitionProvider = vscode.languages.registerDefinitionProvider('yaml', {
        provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
            const lineText = document.lineAt(position.line).text;
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return undefined;
            }

            const word = document.getText(wordRange);

            // Search for node definition
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
                return references;
            }

            const word = document.getText(wordRange);

            // Search for references in 'next' sections and other node references
            const referencePatterns = [
                new RegExp(`^\\s*-\\s*${word}\\s*$`), // next: references
                new RegExp(`^\\s*${word}:\\s*`), // node definitions or references in outputs
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

            return references;
        }
    });

    return [definitionProvider, referencesProvider];
}