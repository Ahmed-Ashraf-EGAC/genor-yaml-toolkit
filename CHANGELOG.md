# Changelog

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
2. Search for `yamlFormatter` or open `settings.json`.  
3. Add your preferred configuration:

   ```json
   {
     "yamlFormatter.indentation": 4,
     "yamlFormatter.wrapLines": 100
   }
   ```

#### 🔧 Available Options

- **`yamlFormatter.indentation`** – Set spaces for indentation (`default: 2`).
- **`yamlFormatter.wrapLines`** – Define max line width (`-1` for no wrapping).

---

#### 2️⃣ Format on Save (Optional)

Enable automatic YAML formatting when saving a file.

#### 🧠 How to Enable Format on Save

1. Open **VS Code Settings** (`Ctrl + ,`).
2. Search for `yamlFormatter.formatOnSave`.
3. Set it to `true`:

   ```json
   {
     "yamlFormatter.formatOnSave": true
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

🚀 **Need Help?** Open an issue on [GitHub](https://github.com/your-username/yaml-formatter/issues).
