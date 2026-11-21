import { path } from 'zx';

export const documentDirectory = (title: string, issueNumber: string) => {
    const slug = title
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N} .()_-]+/gu, '-')
        .replace(/\.{2,}/g, '.')
        .trim()
        .replace(/^[ .-]+|[ .-]+$/g, '')
        .replace(/[ ._-]+/g, '-')
        .slice(0, 100);
    return path.join('documents', `${slug || 'issue'}-${issueNumber}`);
};
