# YAML Formatter for VS Code

An extension to automatically format YAML files and manage agent templates for GenOr workflows in Visual Studio Code.

## Features

### 1️⃣ YAML Formatting

- Formats YAML files with **indentation of 2 spaces** and **unlimited line width**
- Preserves double quotes around keys that originally had them
- Keeps unquoted keys unquoted
- Maintains consistent spacing and structure
- Supports **Shift + Alt + F** (default VS Code format shortcut)
- Optionally **formats YAML on save** (configurable in settings)

### 2️⃣ Agent Templates

- Quick-access agent templates via right-click menu
- Supports common GenOr agent types:
  - Code Agent
  - LLM Agent
  - Aggregator
  - IfElse
  - Iterator
- Auto-indentation based on cursor position
- Preserves multi-line prompt blocks

## Installation

### Install from VSIX (Manual Installation)

1. Download the `.vsix` file from the [Releases](https://github.com/Ahmed-Ashraf-EGAC/yaml-formatter/releases/tag/first-release)
2. Open **VS Code**
3. Press `Ctrl + Shift + P` and select **Extensions: Install from VSIX**
4. Choose the downloaded `.vsix` file
5. Reload VS Code

## Usage

### Format YAML Manually

- Open a `.yaml` or `.yml` file
- Press `Shift + Alt + F` (**Cmd + Shift + F** on macOS)
- The file will be formatted automatically

### Insert Agent Templates

1. Open a YAML file
2. Right-click where you want to insert the agent
3. Select "Add Agent" from the context menu
4. Choose the desired agent template
5. The template will be inserted with proper indentation

### Format YAML on Save (Optional)

You can enable auto-formatting on save:

1. Open VS Code **Settings** (`Ctrl + ,`)
2. Search for `yamlFormatter.formatOnSave`
3. Enable the setting
4. Now, every time you save a YAML file, it will be formatted automatically

Alternatively, add this to your `settings.json`:

```json
{
  "yamlFormatter.formatOnSave": true
}
```

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `yamlFormatter.formatOnSave` | `boolean` | `false` | Automatically format YAML files on save |
| `yamlFormatter.indentation` | `number` | `2` | Number of spaces for indentation |
| `yamlFormatter.wrapLines` | `number` | `-1` | Maximum line width (-1 for no limit) |

## Development

### Build and Package

If you want to modify or contribute to this extension:

1. Clone the repository.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Compile the extension:

   ```sh
   npm run compile
   ```

4. Package it as a `.vsix` file:

   ```sh
   vsce package
   ```

### Running in VS Code (Development Mode)

1. Open the project folder in VS Code.
2. Press `F5` to launch a new VS Code window with the extension loaded.

## Changelog

For a detailed list of changes, see the [CHANGELOG](https://github.com/Ahmed-Ashraf-EGAC/yaml-formatter/blob/master/CHANGELOG.md).

## Issues & Contributions

If you find any issues or want to contribute:

- Open an issue on [GitHub](https://github.com/Ahmed-Ashraf-EGAC/yaml-formatter/issues)
- Submit a pull request with your changes.

---
Enjoy seamless YAML formatting in VS Code! 🚀
