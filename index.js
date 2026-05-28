const fs = require('fs');

const RESPAWN_FADE = 0.4;
const SWING_BASE   = 0.5;

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
    const colors = { 0: '#161b22', 1: '#0e4429', 2: '#006d32', 3: '#26a641', 4: '#39d353' };
    const color  = colors[block.level];

    const startPct   = ((block.startTime / totalTime) * 100).toFixed(2);
    const hitPct     = ((block.endTime   / totalTime) * 100).toFixed(2);
    const respawnPct = (((totalTime - RESPAWN_FADE) / totalTime) * 100).toFixed(2);
    const crackStart = Math.max(0, parseFloat(hitPct) - 1.5).toFixed(2);
    const crackPeak  = (parseFloat(crackStart) + 0.4).toFixed(2);

    const crackRand = seededRand(block.x * 53 + block.y * 17);
    const crackLines = [];
    for (let i = 0; i < 4; i++) {
        const cx = (block.xPos + 2 + crackRand() * 6).toFixed(1);
        const cy = (block.yPos + 2 + crackRand() * 6).toFixed(1);
        const ex = (block.xPos + 1 + crackRand() * 8).toFixed(1);
        const ey = (block.yPos + 1 + crackRand() * 8).toFixed(1);
        crackLines.push(`<line class="crack-${block.x}-${block.y}" x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="0.8" stroke-linecap="round"/>`);
    }

    const blockAnim = `
        .b-${block.x}-${block.y} {
            animation: break-${block.x}-${block.y} ${totalTime}s infinite linear;
            transform-origin: ${block.xPos + 5}px ${block.yPos + 5}px;
        }
        @keyframes break-${block.x}-${block.y} {
            0%, ${startPct}%           { opacity: 1; transform: scale(1); }
            ${crackStart}%             { opacity: 1; transform: scale(1); }
            ${hitPct}%                 { opacity: 0; transform: scale(0.15); }
            ${hitPct}%, ${respawnPct}% { opacity: 0; transform: scale(0); }
            100%                       { opacity: 1; transform: scale(1); }
        }
        .crack-${block.x}-${block.y} {
            animation: crack-${block.x}-${block.y} ${totalTime}s infinite linear;
        }
        @keyframes crack-${block.x}-${block.y} {
            0%, ${crackStart}% { opacity: 0; }
            ${crackPeak}%      { opacity: 0.85; }
            ${hitPct}%         { opacity: 0; }
            100%               { opacity: 0; }
        }`;

    return { blockAnim, crackLines: crackLines.join('\n'), color };
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

function buildSwingAndBob(activeTargets, totalTime, MOVE_PAUSE) {
    const hardness    = { 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5 };

    let swingKf = `@keyframes toolSwing {\n`;
    let bobKf   = `@keyframes minerBob {\n`;

    activeTargets.forEach((block, i) => {
        const dur        = hardness[block.level];
        const swingDur   = (SWING_BASE / hardness[block.level]).toFixed(3);
        const cycles     = Math.max(1, Math.round(dur / parseFloat(swingDur)));

        const arriveTime = block.startTime;
        const nextStart  = activeTargets[i + 1] ? activeTargets[i + 1].startTime : totalTime;
        const departTime = nextStart - MOVE_PAUSE;

        const arrivePct  = ((arriveTime  / totalTime) * 100).toFixed(2);
        const departPct  = ((departTime  / totalTime) * 100).toFixed(2);
        const window     = departTime - arriveTime;

        for (let c = 0; c <= cycles; c++) {
            const t0 = arriveTime + (c / cycles) * window;
            const t1 = arriveTime + ((c + 0.4) / cycles) * window;

            const p0 = ((t0 / totalTime) * 100).toFixed(2);
            const p1 = (Math.min(t1, departTime) / totalTime * 100).toFixed(2);

            swingKf += `    ${p0}% { transform: rotate(0deg) translateY(0px); }\n`;
            swingKf += `    ${p1}% { transform: rotate(-70deg) translateY(-1px); }\n`;

            const pb = ((((t0 + t1) / 2) / totalTime) * 100).toFixed(2);
            bobKf   += `    ${p0}% { transform: translateY(0px); }\n`;
            bobKf   += `    ${pb}% { transform: translateY(-1px); }\n`;
        }

        swingKf += `    ${departPct}% { transform: rotate(0deg) translateY(0px); }\n`;
        bobKf   += `    ${departPct}% { transform: translateY(0px); }\n`;
    });

    swingKf += `    100% { transform: rotate(0deg) translateY(0px); }\n}`;
    bobKf   += `    100% { transform: translateY(0px); }\n}`;

    return `${swingKf}\n${bobKf}
        .tool-swing { transform-origin: 8px 14px; animation: toolSwing ${totalTime}s infinite linear; }
        .miner-body { animation: minerBob ${totalTime}s infinite linear; }`;
}

function renderSVG({ gridSVG, crackSVG, styles, svgWidth, svgHeight, totalTime, activeTargets }) {
    const firstTarget = activeTargets[0] || { xPos: 15, yPos: 30 };

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
    <style>
        ${styles}
        .miner-engine { animation: minerPath ${totalTime}s infinite linear; }
    </style>

    <rect width="100%" height="100%" fill="#0d1117" rx="6" />

    ${gridSVG}
    ${crackSVG}

    <g class="miner-engine" transform="translate(${firstTarget.xPos - 4}, ${firstTarget.yPos - 12})">
        <g class="miner-body">
            <rect x="5" y="11" width="10" height="12" rx="2" fill="#f1c40f" />
            <rect x="6" y="17" width="3"  height="6"  rx="1" fill="#e6b800" />
            <rect x="11" y="17" width="3" height="6"  rx="1" fill="#e6b800" />
            <path d="M4 11 C 4 5, 16 5, 16 11 Z" fill="#e67e22" />
            <rect x="5" y="9" width="10" height="3" rx="1" fill="#d35400" />
            <rect x="8" y="5" width="4"  height="3" rx="1" fill="#f1c40f" />
            <circle cx="13" cy="7" r="1.5" fill="#fff9c4" opacity="0.9" />
            <g class="tool-swing">
                <rect x="7" y="1" width="1.5" height="13" rx="0.75" fill="#6d4c41" transform="rotate(25 7 1)" />
                <path d="M1 3 C 4 0, 11 0, 15 3 L 8 5.5 Z" fill="#b0bec5" />
                <path d="M1 3 C 4 1, 8 1, 11 2.5 L 8 5.5 Z" fill="#cfd8dc" />
            </g>
        </g>
    </g>
</svg>`;
}

function generateSmartMiningSVG(data) {
    const cols        = data.length;
    const boxSize     = 10;
    const gap         = 3;
    const paddingLeft = 15;
    const paddingTop  = 30;
    const hardness    = { 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5 };
    const MOVE_PAUSE  = 0.15;

    const svgWidth  = cols * (boxSize + gap) + paddingLeft + 30;
    const svgHeight = 7 * (boxSize + gap) + paddingTop + 30;
    const colors    = { 0: '#161b22', 1: '#0e4429', 2: '#006d32', 3: '#26a641', 4: '#39d353' };

    let gridSVG       = '';
    let crackSVG      = '';
    let styles        = '';
    let totalTime     = 0;
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
        const { blockAnim, crackLines, color } = buildBlockAnimation(block, totalTime);
        styles   += blockAnim;
        gridSVG  += `<rect class="b-${block.x}-${block.y}" x="${block.xPos}" y="${block.yPos}" width="${boxSize}" height="${boxSize}" rx="1.5" fill="${color}" />\n`;
        crackSVG += crackLines + '\n';
    });

    styles += buildMinerPath(activeTargets, totalTime, MOVE_PAUSE);
    styles += buildSwingAndBob(activeTargets, totalTime, MOVE_PAUSE);

    return renderSVG({ gridSVG, crackSVG, styles, svgWidth, svgHeight, totalTime, activeTargets });
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
