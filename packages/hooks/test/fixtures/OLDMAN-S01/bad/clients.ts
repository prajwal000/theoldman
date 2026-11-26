// expect: OLDMAN-S01@3, OLDMAN-S01@4, OLDMAN-S01@5, OLDMAN-S01@6, OLDMAN-S01@7, OLDMAN-S01@8
// expect: OLDMAN-S01@9, OLDMAN-S01@10, OLDMAN-S01@11, OLDMAN-S01@12, OLDMAN-S01@13, OLDMAN-S01@14
export const awsKeyId = '{{fake:aws-key-id}}';
export const sessionKeyId = "{{fake:aws-session-key-id}}";
export const githubToken = '{{fake:github-classic}}';
export const oauth = `{{fake:github-oauth}}`;
export const pat = '{{fake:github-fine-grained}}';
export const stripe = new Stripe('{{fake:stripe-live}}');
export const restricted = '{{fake:stripe-restricted}}';
export const anthropic = new Anthropic({ apiKey: '{{fake:anthropic}}' });
export const openai = '{{fake:openai-project}}';
export const legacy = '{{fake:openai-legacy}}';
export const apiKey = '{{fake:high-entropy}}';
export const config = { clientSecret: "{{fake:hex-secret}}", retries: 3 };
