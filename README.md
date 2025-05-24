# GenOr YAML Toolkit for VS Code

A comprehensive toolkit for working with YAML files in GenOr workflows within Visual Studio Code.

## Features

- **YAML Formatting**: Automatically format YAML files with customizable indentation and line wrapping
- **GenOr Agent Templates**: Easily insert agent templates into your workflow files
- **Node Navigation**: Jump to node definitions with F12
- **Reference Finding**:
  - Find references within the current file (Shift+F12)
  - Find references across all workspace files (Ctrl+Shift+F12)

## Configuration Options

- `genorYamlToolkit.formatOnSave`: Enable/disable automatic formatting on save
- `genorYamlToolkit.indentation`: Set the number of spaces for indentation
- `genorYamlToolkit.wrapLines`: Configure line wrapping (use -1 for no limit)

## Commands

- `Format YAML`: Format the current YAML document
- `GenOr: Insert Agent`: Insert a GenOr agent template at the cursor position
- `YAML: Find All References Across Files`: Find all references to the selected node across all YAML files in the workspace

## Keyboard Shortcuts

- `Shift+Alt+F`: Format the current YAML document
- `F12`: Go to definition
- `Shift+F12`: Find all references in current file
- `Ctrl+Shift+F12`: Find all references across all workspace files
