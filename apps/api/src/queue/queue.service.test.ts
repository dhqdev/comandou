import { describe, expect, it } from 'vitest';
import { redisConnection } from './queue.service';

describe('redisConnection', () => {
  it('converte a URL do Redis em opções do ioredis', () => {
    expect(redisConnection('redis://:s%40nha@redis:6380/2')).toEqual({
      host: 'redis',
      port: 6380,
      password: 's@nha',
      db: 2,
      maxRetriesPerRequest: null,
    });
    expect(redisConnection('rediss://user:pw@cache.example')).toMatchObject({
      host: 'cache.example',
      port: 6379,
      username: 'user',
      password: 'pw',
      tls: {},
    });
  });
});
