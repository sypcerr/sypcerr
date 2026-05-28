const fs = require('fs');

async function getContributions() {
    const token = process.env.GITHUB_TOKEN;
    const username = process.env.GITHUB_REPOSITORY.split('/')[0];

    const query = {
        query: `query {
            user(login: "${username}") {
                contributionsCollection {
                    contributionCalendar {
                        weeks {
                            contributionDays {
                                contributionLevel
                            }
                        }
                    }
                }
            }
        }`
    };

    const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(query)
    });

    const resData = await response.json();
    if (!resData.data || !resData.data.user) {
        throw new Error('API-Fehler. Überprüfe die Berechtigungen.');
    }

    const weeks = resData.data.user.contributionsCollection.contributionCalendar.weeks;
    const levelMap = { 'NONE': 0, 'FIRST_QUARTILE': 1, 'SECOND_QUARTILE': 2, 'THIRD_QUARTILE': 3, 'FOURTH_QUARTILE': 4 };

    let matrix = [];
    weeks.forEach(week => {
        let weekDays = week.contributionDays.map(day => levelMap[day.contributionLevel]);
        while (weekDays.length < 7) weekDays.push(0);
        matrix.push(weekDays);
    });

    return matrix.slice(-53);
}

function generateSmartMiningSVG(data) {
    const rows = 7;
    const cols = data.length;
    const boxSize = 10;
    const gap = 3;
    const paddingLeft = 15;
    const paddingTop = 30;
    
    const svgWidth = cols * (boxSize + gap) + paddingLeft + 30;
    const svgHeight = rows * (boxSize + gap) + paddingTop + 30;

    const colors = { 0: '#161b22', 1: '#0e4429', 2: '#006d32', 3: '#26a641', 4: '#39d353' };
    const hardness = { 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5 };

    let gridSVG = '';
    let particleSVG = '';
    let styles = '';
    
    let totalTime = 0;
    let activeTargets = [];

    // 1. Erst das statische Gitternetz zeichnen und nur aktive Blöcke für den Pfad filtern
    for (let x = 0; x < cols; x++) {
        // Zickzack-Reihenfolge beibehalten, damit der Miner logisch läuft
        const yOrder = (x % 2 === 0) ? [0,1,2,3,4,5,6] : [6,5,4,3,2,1,0];
        
        for (let y of yOrder) {
            const level = data[x][y] || 0;
            const xPos = paddingLeft + x * (boxSize + gap);
            const yPos = paddingTop + y * (boxSize + gap);

            if (level > 0) {
                const duration = hardness[level];
                activeTargets.push({
                    x: x, y: y,
                    xPos: xPos, yPos: yPos,
                    startTime: totalTime,
                    endTime: totalTime + duration,
                    level: level
                });
                totalTime += duration + 0.15; // Abbauzeit + Wechselzeit
            } else {
                // Graue Blöcke einfach nur rendern, keine Animationen verpassen
                gridSVG += `<rect x="${xPos}" y="${yPos}" width="${boxSize}" height="${boxSize}" rx="1.5" fill="${colors[0]}" />\n`;
            }
        }
    }

    // Sicherheitsfallback: Falls jemand absolut 0 Commits im Jahr hat
    if (activeTargets.length === 0) {
        totalTime = 5;
        styles += `@keyframes minerPath { 0%, 100% { transform: translate(${paddingLeft}px, ${paddingTop}px); } }`;
    }

    // 2. CSS-Animationen für aktive Blöcke, Partikel und den Miner-Pfad generieren
    activeTargets.forEach((block) => {
        const color = colors[block.level];
        const startPct = ((block.startTime / totalTime) * 100).toFixed(2);
        const hitPct = ((block.endTime / totalTime) * 100).toFixed(2);
        const respawnPct = (((block.endTime + 5) / totalTime) * 100).toFixed(2);
        const resetPct = (((block.endTime + 5.2) / totalTime) * 100).toFixed(2);

        styles += `
            .b-${block.x}-${block.y} {
                animation: break-${block.x}-${block.y} ${totalTime}s infinite linear;
                transform-origin: ${block.xPos + boxSize/2}px ${block.yPos + boxSize/2}px;
            }
            @keyframes break-${block.x}-${block.y} {
                0%, ${startPct}% { opacity: 1; transform: scale(1); fill: ${color}; }
                ${hitPct}%, ${respawnPct}% { opacity: 0; transform: scale(0); }
                ${resetPct}%, 100% { opacity: 1; transform: scale(1); }
            }
            .p-${block.x}-${block.y} {
                animation: shatter-${block.x}-${block.y} ${totalTime}s infinite linear;
            }
            @keyframes shatter-${block.x}-${block.y} {
                0%, ${startPct}% { opacity: 0; transform: translate(0px, 0px); }
                ${startPct + 0.1}% { opacity: 1; }
                ${hitPct} { opacity: 1; transform: translate(${(Math.random() * 14 - 7).toFixed(1)}px, ${(Math.random() * 12 + 8).toFixed(1)}px) rotate(${Math.random() * 180}deg); }
                ${hitPct + 1}%, 100% { opacity: 0; }
            }
        `;

        gridSVG += `<rect class="b-${block.x}-${block.y}" x="${block.xPos}" y="${block.yPos}" width="${boxSize}" height="${boxSize}" rx="1.5" />\n`;
        
        particleSVG += `
            <g class="p-${block.x}-${block.y}" transform="translate(${block.xPos}, ${block.yPos})">
                <rect x="1" y="1" width="3" height="3" fill="${color}" />
                <rect x="6" y="1" width="3" height="3" fill="${color}" />
                <rect x="1" y="6" width="3" height="3" fill="${color}" />
                <rect x="6" y="6" width="3" height="3" fill="${color}" />
            </g>
        `;
    });

    // Miner-Pfad-Keyframes (Springt nur von aktivem zu aktivem Block)
    if (activeTargets.length > 0) {
        let minerKeyframes = '@keyframes minerPath {\n';
        activeTargets.forEach((block) => {
            const pct = ((block.startTime / totalTime) * 100).toFixed(2);
            // Miner leicht versetzt positionieren, damit die Hacke den Block trifft
            minerKeyframes += `    ${pct}% { transform: translate(${block.xPos - 4}px, ${block.yPos - 12}px); }\n`;
        });
        minerKeyframes += `    100% { transform: translate(${activeTargets[0].xPos - 4}px, ${activeTargets[0].yPos - 12}px); }\n}`;
        styles += minerKeyframes;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
    <style>
        ${styles}
        @keyframes pickaxeSwing {
            0% { transform: rotate(0deg); }
            50% { transform: rotate(-65deg); }
            100% { transform: rotate(0deg); }
        }
        .miner-engine {
            animation: minerPath ${totalTime}s infinite linear;
        }
        .tool-swing {
            transform-origin: 8px 15px;
            animation: pickaxeSwing 0.2s infinite ease-in-out;
        }
    </style>

    <rect width="100%" height="100%" fill="#0d1117" rx="6" />

    ${gridSVG}
    ${particleSVG}

    <g class="miner-engine">
        <g>
            <rect x="5" y="10" width="10" height="14" rx="2" fill="#f1c40f" />
            <path d="M4 10 C 4 4, 16 4, 16 10 Z" fill="#e67e22" />
            <rect x="8" y="5" width="4" height="2" fill="#f1c40f" />
            <polygon points="12,6 25,2 25,14" fill="#f1c40f" opacity="0.12" />
            
            <g class="tool-swing">
                <rect x="6" y="2" width="2" height="14" rx="1" fill="#795548" transform="rotate(30 6 2)" />
                <path d="M0 2 C 4 0, 10 0, 14 2 L 7 4 Z" fill="#95a5a6" />
            </g>
        </g>
    </g>
</svg>`;
}

async function main() {
    try {
        const commitData = await getContributions();
        const svgContent = generateSmartMiningSVG(commitData);
        fs.writeFileSync('mining-grid.svg', svgContent);
        console.log('💎 Smarter Miner erfolgreich generiert!');
    } catch (error) {
        console.error('Fehler:', error.message);
        process.exit(1);
    }
}

main();
