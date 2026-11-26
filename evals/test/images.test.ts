import { describe, expect, it } from 'vitest';
import { IMAGES, imageRefs, REGISTRIES, SERVICES } from '../src/images.ts';

// Official images only: eval runs must not depend on an image that exists on one machine.
const PUBLIC_IMAGES = new Set(['node', 'postgres']);

describe('pinned images', () => {
  it.each(Object.entries(IMAGES))(
    '%s is a public official image pinned by digest',
    (key, image) => {
      expect(image.name).toBe(key);
      expect(PUBLIC_IMAGES.has(image.name)).toBe(true);
      expect(image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(image.tag).toMatch(/^\d+(?:\.\d+)+-[a-z]+(?:-slim)?$/);
    },
  );

  it('pulls from Docker Hub first and its ECR Public mirror second, with the same digest', () => {
    expect(REGISTRIES).toEqual(['docker.io/library', 'public.ecr.aws/docker/library']);
    expect(imageRefs(IMAGES.node)).toEqual([
      `docker.io/library/node:${IMAGES.node.tag}@${IMAGES.node.digest}`,
      `public.ecr.aws/docker/library/node:${IMAGES.node.tag}@${IMAGES.node.digest}`,
    ]);
  });

  it('backs every service with a pinned image', () => {
    for (const service of SERVICES) expect(IMAGES[service].digest).toMatch(/^sha256:/);
  });
});
