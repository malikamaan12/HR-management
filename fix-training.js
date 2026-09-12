const fs = require('fs');

// Read the content of the file
const filePath = 'server/routes/training.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace patterns with proper token payload usage
content = content.replace(/req\.user\.employee && req\.user\.employee\.id/g, 'false /* Placeholder: needs user-employee mapping */');
content = content.replace(/req\.user\.roles && \(req\.user\.roles\.includes\('admin'\) \|\| req\.user\.roles\.includes\('hr'\)\)/g, "(req.user.role === 'admin' || req.user.role === 'hr')");
content = content.replace(/req\.user\.employeeId/g, "false /* Placeholder: needs employee ID mapping */");

// Write the modified content back to the file
fs.writeFileSync(filePath, content);

console.log('Updated training.ts file');
