const fs = require('fs');

// Read the content of the file
const filePath = 'server/routes/training.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace patterns with proper token payload usage
content = content.replace(/req\.user && req\.user\.employee && req\.user\.employee\.id === employeeId/g, 'req.user && false /* Placeholder: needs user-employee mapping */');
content = content.replace(/req\.user && req\.user\.roles && \(req\.user\.roles\.includes\('admin'\) \|\| req\.user\.roles\.includes\('hr'\)\)/g, "req.user && (req.user.role === 'admin' || req.user.role === 'hr')");
content = content.replace(/req\.user && req\.user\.employeeId === employeeId/g, "req.user && false /* Placeholder: needs employee ID mapping */");
content = content.replace(/req\.user && \(req\.user\.role === 'admin' \|\| req\.user\.role === 'hr'\)/g, "req.user && (req.user.role === 'admin' || req.user.role === 'hr')");

// Write the modified content back to the file
fs.writeFileSync(filePath, content);

console.log('Updated training.ts file');
