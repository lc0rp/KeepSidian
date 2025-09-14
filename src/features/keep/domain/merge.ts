export function mergeNoteBodies(existingBody: string, incomingBody: string): { merged: string; hasConflict: boolean } {
    const existingLines = existingBody.split('\n');
    const incomingLines = incomingBody.split('\n');

    const m = existingLines.length;
    const n = incomingLines.length;
    const lcsMatrix: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (existingLines[i] === incomingLines[j]) {
                lcsMatrix[i][j] = lcsMatrix[i + 1][j + 1] + 1;
            } else {
                lcsMatrix[i][j] = Math.max(lcsMatrix[i + 1][j], lcsMatrix[i][j + 1]);
            }
        }
    }

    const lcs: string[] = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
        if (existingLines[i] === incomingLines[j]) {
            lcs.push(existingLines[i]);
            i++; j++;
        } else if (lcsMatrix[i + 1][j] >= lcsMatrix[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }

    const mergedLines: string[] = [];
    let ai = 0, bi = 0;
    let conflict = false;
    for (const line of lcs) {
        const aEnd = existingLines.indexOf(line, ai);
        const bEnd = incomingLines.indexOf(line, bi);
        const aSegment = existingLines.slice(ai, aEnd);
        const bSegment = incomingLines.slice(bi, bEnd);
        if (aSegment.length && bSegment.length) {
            conflict = true;
            mergedLines.push('<<<<<<< existing');
            mergedLines.push(...aSegment);
            mergedLines.push('=======');
            mergedLines.push(...bSegment);
            mergedLines.push('>>>>>>> incoming');
        } else if (aSegment.length) {
            mergedLines.push(...aSegment);
        } else if (bSegment.length) {
            mergedLines.push(...bSegment);
        }
        mergedLines.push(line);
        ai = aEnd + 1;
        bi = bEnd + 1;
    }

    const aSegment = existingLines.slice(ai);
    const bSegment = incomingLines.slice(bi);
    if (aSegment.length && bSegment.length) {
        conflict = true;
        mergedLines.push('<<<<<<< existing');
        mergedLines.push(...aSegment);
        mergedLines.push('=======');
        mergedLines.push(...bSegment);
        mergedLines.push('>>>>>>> incoming');
    } else if (aSegment.length) {
        mergedLines.push(...aSegment);
    } else if (bSegment.length) {
        mergedLines.push(...bSegment);
    }

    return { merged: mergedLines.join('\n'), hasConflict: conflict };
}
