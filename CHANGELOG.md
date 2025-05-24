# Changelog

## [0.1.0] - 2025-05-24

### ✨ New Features

#### 1️⃣ Extension Renamed to GenOr YAML Toolkit

The extension has been renamed from "YAML Formatter" to "GenOr YAML Toolkit" to better reflect its purpose as a comprehensive toolkit for working with YAML files in GenOr workflows.

#### 2️⃣ Cross-File Reference Finding

Find all references to a node across all YAML files in your workspace.

#### 🧠 How to Use Node Navigation & References

1. Place your cursor on a node name in a YAML file
2. Use one of these keyboard shortcuts:
   - `F12` - Go to node definition
   - `Shift+F12` - Find all references in current file
   - `Ctrl+Shift+F12` - Find all references across all workspace files
3. Alternatively, right-click and select "YAML: Find All References Across Files"
4. View all references in the search results panel

---

## [0.0.3] - 2025-05-23

### ✨ New Features

#### 1️⃣ Agent Template Support

Right-click menu now includes agent template insertion for quick YAML scaffolding.

#### 🧠 Available Agent Templates

- Code Agent
- LLM Agent
- Aggregator
- IfElse
- Iterator

#### 📝 How to Use

1. Right-click in any YAML file
2. Select "Add Agent"
3. Choose from available templates

---

## [0.0.2] - 2025-03-21

### ✨ New Features

#### 1️⃣ Custom Formatting Options

You can now configure YAML formatting via **VS Code settings (`settings.json`)**.

#### 🧠 How to Enable Custom Formatting

1. Open **VS Code Settings** (`Ctrl + ,`).  
2. Search for `genorYamlToolkit` or open `settings.json`.  
3. Add your preferred configuration:

   ```json
   {
     "genorYamlToolkit.indentation": 4,
     "genorYamlToolkit.wrapLines": 100
   }
   ```

#### 🔧 Available Options

- **`genorYamlToolkit.indentation`** – Set spaces for indentation (`default: 2`).
- **`genorYamlToolkit.wrapLines`** – Define max line width (`-1` for no wrapping).

---

#### 2️⃣ Format on Save (Optional)

Enable automatic YAML formatting when saving a file.

#### 🧠 How to Enable Format on Save

1. Open **VS Code Settings** (`Ctrl + ,`).
2. Search for `genorYamlToolkit.formatOnSave`.
3. Set it to `true`:

   ```json
   {
     "genorYamlToolkit.formatOnSave": true
   }
   ```

📝 **Note:** This option is disabled by default.

---

### 🛠️ Bug Fixes & Enhancements

- ✅ Improved multi-line value handling.
- ✅ Enhanced performance for large YAML files.

---

## [0.0.1] - 2025-03-15

### 🎉 Initial Release

- Basic YAML formatting with preserved styles.

---

🚀 **Need Help?** Open an issue on [GitHub](https://github.com/Ahmed-Ashraf-EGAC/genor-yaml-toolkit/issues).
