try {
  const electron = require('electron');
  console.log('type:', typeof electron);
  if (typeof electron === 'object') {
    console.log('app:', typeof electron.app);
  } else {
    console.log('Got string, not module. Trying electron.app directly...');
    // The built-in 'electron' module might need different import
  }
} catch(e) {
  console.log('Error:', e.message);
}
process.exit(0);
