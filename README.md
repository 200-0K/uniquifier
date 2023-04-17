This script takes a folder as input and prefixes the names of files with a unique identifier based on the folder they are in (+ some random hash). This helps to prevent naming conflicts when merging files from different folders or sources.

## Features
- Prefixes filenames with a unique identifier based on folder name
- Works recursively through subfolders
- Can be used with any file type

## Requirements
- [Node](https://nodejs.org/en/download)

## Usage
- Clone the repository
- Navigate to the folder containing the script
- Install the dependencies with the following command: `npm install`
- Run the script: `node uniquifier.js <path>`

> **Note**
> To make it easier to run `uniquifier` from anywhere in your system, consider adding the `bat` folder to your [PATH environment variable](https://www.architectryan.com/2018/03/17/add-to-the-path-on-windows-10/). This will make the script accessible from anywhere within your system.


### Example Usage
Current path:
```
Folder 1/
├── 1.txt
├── 2.txt
├── 3.txt
└── 4.txt
Folder 2/
├── 1.txt
├── 2.txt
├── 3.txt
└── 4.txt
```

Executing the script:
```
uniquifier .
```

Current path:
```
Folder 1/
├── [w46GS-fc8659~]1.txt
├── [w46GS-fc8659~]2.txt
├── [w46GS-fc8659~]3.txt
└── [w46GS-fc8659~]4.txt
Folder 2/
├── [9EHQ3-3bc921~]1.txt
├── [9EHQ3-3bc921~]2.txt
├── [9EHQ3-3bc921~]3.txt
└── [9EHQ3-3bc921~]4.txt
```