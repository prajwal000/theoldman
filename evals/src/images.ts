// Every container an eval starts comes from a public official image pinned by digest, so a run
// can be repeated on any machine and never depends on an image that exists only locally. Docker
// Hub is tried first; its official images are mirrored with the same digests on ECR Public, which
// is the fallback when Docker Hub is unreachable.

export interface PinnedImage {
  readonly name: string;
  /** Readable version; the digest is what is pulled. */
  readonly tag: string;
  readonly digest: string;
}

export const REGISTRIES = ['docker.io/library', 'public.ecr.aws/docker/library'] as const;

export const IMAGES = {
  node: {
    name: 'node',
    tag: '22.23.5-bookworm-slim',
    digest: 'sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb',
  },
  postgres: {
    name: 'postgres',
    tag: '17.12-bookworm',
    digest: 'sha256:1eff563f6c868b9b433566e9f3cf6e5c79fbd3b95bf70ec7277d376cdbfc50d7',
  },
} as const satisfies Record<string, PinnedImage>;

/** Claude Code version installed in the agent image. Changing it changes what the evals measure. */
export const CLAUDE_CODE_VERSION = '2.1.332';

/**
 * npm version installed in the agent image. The npm bundled with Node 22 (10.9) crashes with
 * "Cannot read properties of null (reading 'edgesOut')" when installing vitest 5, in a run and
 * when scoring alike.
 */
export const NPM_VERSION = '11.21.3';

/** Local tag of the agent image built from evals/docker/Dockerfile on the pinned node image. */
export const AGENT_IMAGE = `theoldman-evals-agent:claude-${CLAUDE_CODE_VERSION}-npm-${NPM_VERSION}-node-${IMAGES.node.tag}`;

/** Services a task can ask for, each backed by one of the images above. */
export const SERVICES = ['postgres'] as const;
export type Service = (typeof SERVICES)[number];

/** Pull references for an image, Docker Hub first, all with the same digest. */
export function imageRefs(image: PinnedImage): string[] {
  return REGISTRIES.map((registry) => `${registry}/${image.name}:${image.tag}@${image.digest}`);
}
