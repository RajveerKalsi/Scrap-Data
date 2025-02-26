const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const schedule = require('node-schedule');

const app = express();
const PORT = 3000;

const scripts = ['scrapeTG_mountit.js','scrapeNE_mountit.js','scrapeBB_mountit.js','scrapeQ_mountit.js', 'scrapeS_mountit.js', 'scrapeHD_mountit.js', 'scrapeOD_mountit.js', 'scrapeBnH_mountit.js'];
const scriptPath = __dirname;

async function runScripts() {
    for (const script of scripts) {
        const fullPath = path.join(scriptPath, script);
        console.log(`Running ${script}...`);

        try {
            await new Promise((resolve, reject) => {
                const command = `$env:NODE_ENV="PROD"; node "${fullPath}"`;
                const process = exec(command, { shell: 'powershell.exe' });

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

schedule.scheduleJob('30 15 * * *', () => {
    console.log('Starting scheduled script execution...');
    runScripts().catch(err => {
        console.error('An unexpected error occurred during execution:', err);
    });
});

app.get('/run-scripts', (req, res) => {
    console.log('Manual execution triggered via API.');
    runScripts()
        .then(() => res.send('Scripts executed successfully.'))
        .catch(err => res.status(500).send(`Error: ${err.message}`));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

console.log('Scheduler is running. Waiting for the scheduled time...');
