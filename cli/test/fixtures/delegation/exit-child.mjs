const code = Number.parseInt(process.argv[2] ?? "0", 10);
process.exit(Number.isInteger(code) ? code : 1);
