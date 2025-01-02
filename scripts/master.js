const { exec } = require('child_process');
const path = require('path');

// Define the scripts to run
const scripts = ['scrapeQ.js', 'scrapeS.js', 'scrapeHD.js', 'scrapeOD.js'];
const scriptPath = __dirname; // Directory where this script is located

async function runScripts() {
    for (const script of scripts) {
        const fullPath = path.join(scriptPath, script);
        console.log(`Running ${script}...`);

        try {
            await new Promise((resolve, reject) => {
                const command = `$env:NODE_ENV="PROD"; node "${fullPath}"`;
                const process = exec(command, { shell: 'powershell.exe' });

                // Stream script output directly to the console
                process.stdout.on('data', (data) => {
                    console.log(`[${script}]: ${data}`);
                });

                process.stderr.on('data', (data) => {
                    console.error(`[${script} Error]: ${data}`);
                });

                process.on('close', (code) => {
                    if (code === 0) {
                        console.log(`[${script}] finished successfully.`);
                        resolve();
                    } else {
                        console.error(`[${script}] exited with code ${code}.`);
                        reject(new Error(`[${script}] failed with exit code ${code}`));
                    }
                });
            });
        } catch (error) {
            console.error(`Error while running ${script}:`, error.message);
            console.log(`Continuing to the next script...`);
        }
    }
    console.log('All scripts executed. Check logs for details.');
}

runScripts().catch(err => {
    console.error('An unexpected error occurred during execution:', err);
});
