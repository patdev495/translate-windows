export type OcrLayoutBox = {
  x: number;
  y: number;
  height: number;
};

export type OcrLayoutItem = {
  text: string;
  box: OcrLayoutBox;
};

export function sortByReadingOrder<T extends OcrLayoutItem>(results: T[]): T[] {
  return [...results].sort((a, b) => {
    if (Math.abs(a.box.y - b.box.y) < (a.box.height + b.box.height) / 4) {
      return a.box.x - b.box.x;
    }
    return a.box.y - b.box.y;
  });
}

export function groupResultsIntoLines<T extends OcrLayoutItem>(results: T[]): T[][] {
  const nonEmptyResults = results.filter(result => result.text.trim().length > 0);
  if (nonEmptyResults.length === 0) return [];

  const sorted = sortByReadingOrder(nonEmptyResults);
  const lines: T[][] = [];
  let currentLine: T[] = [sorted[0]];
  let currentLineHeightSum = sorted[0].box.height;
  let avgHeight = sorted[0].box.height;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];
    const verticalGap = Math.abs(current.box.y - previous.box.y);
    const threshold = avgHeight * 0.5;

    if (verticalGap <= threshold) {
      currentLine.push(current);
      currentLineHeightSum += current.box.height;
      avgHeight = currentLineHeightSum / currentLine.length;
    } else {
      currentLine.sort((a, b) => a.box.x - b.box.x);
      lines.push(currentLine);
      currentLine = [current];
      currentLineHeightSum = current.box.height;
      avgHeight = current.box.height;
    }
  }

  currentLine.sort((a, b) => a.box.x - b.box.x);
  lines.push(currentLine);
  return lines;
}

export function assembleOcrLayoutText(results: OcrLayoutItem[]): string {
  return groupResultsIntoLines(results)
    .map(line => line.map(result => result.text.trim()).filter(Boolean).join(' '))
    .join('\n')
    .trim();
}
