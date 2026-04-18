# Vox Programming Language

**Vox** is a custom programming language built using ANTLR and Java, designed with a focus on natural-language-like syntax and a simplified execution model.

## Features

- Natural language-inspired syntax (e.g., `added to`, `is greater than`)
- Custom-built compiler pipeline using ANTLR
- Intermediate Representation (IR) generation via `IRBuilder`
- Fully custom runtime using `IRExecutor` (no LLVM dependency)

### Supported Features

- Variables and data types  
- Arithmetic and logical expressions  
- Conditionals (`if`, `if-else`)  
- Loops (`while`, `for`)  
- Functions and recursion  
- Input/Output operations  

## Architecture Overview

<div style="display: flex; flex-direction: column; align-items: center">

<p>Source Code (.vox)</p>
↓
<p>ANTLR Lexer & Parser</p>
↓
<p>Parse Tree</p>
↓
<p>IRBuilder (Generates IR Instructions)</p>
↓
<p>IRExecutor (Executes Instructions)</p>

</div>

## Components

- `Vox.g4` – Grammar definition for the Vox language  
- `VoxMain.java` – Entry point (parsing + execution pipeline)  
- `IRBuilder.java` – Converts parse tree into IR instructions  
- `IRExecutor.java` – Executes IR instructions using a custom runtime  
- `vox.bat` – CLI tool to compile and run `.vox` files  
- `antlr-4.13.2.jar` – ANTLR dependency  

## Installation & Setup

### 1. Install Java

Install Java 11 or higher:  
https://www.oracle.com/java/technologies/downloads/?er=221886

### 2. Setup Environment Variables

1. Place the Vox folder anywhere (e.g., `C:/Program Files/Vox`)  
2. Copy the folder path  
3. Create a new system variable:
   - **Name:** `VOX_HOME`  
   - **Value:** `<your Vox folder path>`  
4. Edit the `PATH` variable:
   - Add: `%VOX_HOME%`

## Usage

Open a terminal in the directory containing your `.vox` file and run:

```bash
vox <filename.vox>