const fs = require('fs');

const RESPAWN_FADE = 0.3;
const SWING_BASE   = 0.55;

function seededRand(seed) {
    let s = seed;
    return function () {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
    };
}

async function getContributions() {
    const token    = process.env.GITHUB_TOKEN;
    const username = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY.split('/')[0];

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
        throw new Error('API error. Check your permissions and GITHUB_TOKEN.');
    }

    const weeks    = resData.data.user.contributionsCollection.contributionCalendar.weeks;
    const levelMap = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

    let matrix = [];
    weeks.forEach(week => {
        let weekDays = week.contributionDays.map(day => levelMap[day.contributionLevel]);
        while (weekDays.length < 7) weekDays.push(0);
        matrix.push(weekDays);
    });

    return matrix.slice(-53);
}

function buildBlockAnimation(block, totalTime) {
    const rand     = seededRand(block.x * 97 + block.y * 31 + block.level * 7);
    const colors   = { 0: '#161b22', 1: '#0e4429', 2: '#006d32', 3: '#26a641', 4: '#39d353' };
    const color    = colors[block.level];

    const startPct   = ((block.startTime / totalTime) * 100).toFixed(2);
    const hitPct     = ((block.endTime   / totalTime) * 100).toFixed(2);
    const respawnPct = (((totalTime - RESPAWN_FADE) / totalTime) * 100).toFixed(2);

    const px = (rand() * 14 - 7).toFixed(1);
    const py = (rand() * 12 + 8).toFixed(1);
    const pr = Math.floor(rand() * 180);

    const blockAnim = `
        .b-${block.x}-${block.y} {
            animation: break-${block.x}-${block.y} ${totalTime}s infinite linear;
            transform-origin: ${block.xPos + 5}px ${block.yPos + 5}px;
        }
        @keyframes break-${block.x}-${block.y} {
            0%, ${startPct}%           { opacity: 1; transform: scale(1); fill: ${color}; }
            ${hitPct}%, ${respawnPct}% { opacity: 0; transform: scale(0); }
            100%                       { opacity: 1; transform: scale(1); }
        }`;

    const particleAnim = `
        .p-${block.x}-${block.y} {
            animation: shatter-${block.x}-${block.y} ${totalTime}s infinite linear;
        }
        @keyframes shatter-${block.x}-${block.y} {
            0%, ${startPct}%                            { opacity: 0; transform: translate(${block.xPos}px, ${block.yPos}px) rotate(0deg); }
            ${(parseFloat(startPct) + 0.01).toFixed(2)}% { opacity: 1; }
            ${hitPct}%                                  { opacity: 1; transform: translate(${block.xPos + parseFloat(px)}px, ${block.yPos + parseFloat(py)}px) rotate(${pr}deg); }
            ${(parseFloat(hitPct) + 1).toFixed(2)}%, 100% { opacity: 0; transform: translate(${block.xPos + parseFloat(px)}px, ${block.yPos + parseFloat(py)}px) rotate(${pr}deg); }
        }`;

    return { blockAnim, particleAnim, color };
}

function buildMinerPath(activeTargets, totalTime, MOVE_PAUSE) {
    if (activeTargets.length === 0) return '';

    let kf = `@keyframes minerPath {\n`;
    activeTargets.forEach((block, i) => {
        const arriveTime = block.startTime;
        const nextStart  = activeTargets[i + 1] ? activeTargets[i + 1].startTime : totalTime;
        const departTime = nextStart - MOVE_PAUSE;

        const arrivePct = ((arriveTime / totalTime) * 100).toFixed(2);
        const departPct = ((departTime / totalTime) * 100).toFixed(2);
        const tx = block.xPos - 4;
        const ty = block.yPos - 12;

        kf += `    ${arrivePct}% { transform: translate(${tx}px, ${ty}px); }\n`;
        if (departPct !== arrivePct) {
            kf += `    ${departPct}% { transform: translate(${tx}px, ${ty}px); }\n`;
        }
    });
    kf += `    100% { transform: translate(${activeTargets[0].xPos - 4}px, ${activeTargets[0].yPos - 12}px); }\n}`;
    return kf;
}

function buildPickaxeSwing(activeTargets) {
    const hardness = { 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5 };
    const avgHardness = activeTargets.length
        ? activeTargets.reduce((s, b) => s + hardness[b.level], 0) / activeTargets.length
        : 1;
    const avgDur = (SWING_BASE / avgHardness).toFixed(3);

    return `@keyframes pickaxeSwing { 0%{transform:rotate(0deg)} 50%{transform:rotate(-65deg)} 100%{transform:rotate(0deg)} }
        .tool-swing { transform-origin: 8px 15px; animation: pickaxeSwing ${avgDur}s infinite ease-in-out; }`;
}

function renderSVG({ gridSVG, particleSVG, styles, svgWidth, svgHeight, totalTime, activeTargets }) {
    const firstTarget = activeTargets[0] || { xPos: 15, yPos: 30 };

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
    <style>
        ${styles}
        .miner-engine {
            animation: minerPath ${totalTime}s infinite linear;
        }
    </style>

    <rect width="100%" height="100%" fill="#0d1117" rx="6" />

    ${gridSVG}
    ${particleSVG}

    <g class="miner-engine" transform="translate(${firstTarget.xPos - 4}, ${firstTarget.yPos - 12})">
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

function generateSmartMiningSVG(data) {
    const cols       = data.length;
    const boxSize    = 10;
    const gap        = 3;
    const paddingLeft = 15;
    const paddingTop  = 30;
    const hardness    = { 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5 };
    const MOVE_PAUSE  = 0.15;

    const svgWidth  = cols * (boxSize + gap) + paddingLeft + 30;
    const svgHeight = 7 * (boxSize + gap) + paddingTop + 30;
    const colors    = { 0: '#161b22', 1: '#0e4429', 2: '#006d32', 3: '#26a641', 4: '#39d353' };

    let gridSVG      = '';
    let particleSVG  = '';
    let styles       = '';
    let totalTime    = 0;
    let activeTargets = [];

    for (let x = 0; x < cols; x++) {
        const yOrder = (x % 2 === 0) ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];

        for (let y of yOrder) {
            const level = data[x][y] || 0;
            const xPos  = paddingLeft + x * (boxSize + gap);
            const yPos  = paddingTop  + y * (boxSize + gap);

            if (level > 0) {
                const duration = hardness[level];
                activeTargets.push({ x, y, xPos, yPos, level, startTime: totalTime, endTime: totalTime + duration });
                totalTime += duration + MOVE_PAUSE;
            } else {
                gridSVG += `<rect x="${xPos}" y="${yPos}" width="${boxSize}" height="${boxSize}" rx="1.5" fill="${colors[0]}" />\n`;
            }
        }
    }

    if (activeTargets.length === 0) {
        totalTime = 5;
        styles += `@keyframes minerPath { 0%, 100% { transform: translate(${paddingLeft}px, ${paddingTop}px); } }`;
    }

    activeTargets.forEach(block => {
        const { blockAnim, particleAnim, color } = buildBlockAnimation(block, totalTime);
        styles     += blockAnim + particleAnim;
        gridSVG    += `<rect class="b-${block.x}-${block.y}" x="${block.xPos}" y="${block.yPos}" width="${boxSize}" height="${boxSize}" rx="1.5" fill="${color}" />\n`;
        particleSVG += `
            <g class="p-${block.x}-${block.y}">
                <rect x="1" y="1" width="3" height="3" fill="${color}" />
                <rect x="6" y="1" width="3" height="3" fill="${color}" />
                <rect x="1" y="6" width="3" height="3" fill="${color}" />
                <rect x="6" y="6" width="3" height="3" fill="${color}" />
            </g>`;
    });

    styles += buildMinerPath(activeTargets, totalTime, MOVE_PAUSE);
    styles += buildPickaxeSwing(activeTargets);

    return renderSVG({ gridSVG, particleSVG, styles, svgWidth, svgHeight, totalTime, activeTargets });
}

async function main() {
    try {
        const commitData = await getContributions();
        const svgContent = generateSmartMiningSVG(commitData);
        fs.writeFileSync('mining-grid.svg', svgContent);
        console.log('Mining grid generated successfully.');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
