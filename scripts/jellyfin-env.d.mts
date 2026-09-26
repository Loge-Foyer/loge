export function parseEnv(text: string): Record<string, string>;
export function deriveServerUrl(values: { web_ui?: string | undefined; ip?: string | undefined }): string | undefined;
