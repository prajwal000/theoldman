import { describe, expect, it } from 'vitest';
import { checkCommand } from '../../src/rules/guard-bash.js';
import { fakeContext, type FakeOptions } from './fake-context.js';

const ids = (text: string, dialect: 'bash' | 'powershell', options: FakeOptions = {}): string[] =>
  checkCommand(text, dialect, fakeContext(options).context).map((v) => v.id);

describe('OLDMAN-G03 recursive delete', () => {
  const posix: FakeOptions = {
    cwd: '/home/me/proj/web',
    projectRoot: '/home/me/proj',
    home: '/home/me',
  };

  it('resolves relative targets against the working directory, inside or outside the project', () => {
    expect(ids('rm -rf ../api/dist', 'bash', posix)).toEqual([]);
    expect(ids('rm -rf ../../other', 'bash', posix)).toEqual(['OLDMAN-G03']);
    expect(ids('rm -rf /home/me/proj/web/build', 'bash', posix)).toEqual([]);
    expect(ids('rm -rf /home/me/proj', 'bash', posix)).toEqual(['OLDMAN-G03']);
  });

  it('expands the home directory in every spelling', () => {
    for (const home of ['~', '~/', '$HOME', '${HOME}', '"$HOME/code"']) {
      expect(ids(`rm -rf ${home}`, 'bash', posix)).toEqual(['OLDMAN-G03']);
    }
    for (const home of ['$env:HOME', '$env:USERPROFILE\\x', '%USERPROFILE%']) {
      expect(ids(`Remove-Item -Recurse -Force ${home}`, 'powershell')).toEqual(['OLDMAN-G03']);
    }
  });

  it('treats a project inside the home directory correctly', () => {
    const atHome: FakeOptions = { cwd: '/home/me', projectRoot: '/home/me', home: '/home/me' };
    expect(ids('rm -rf ~/build', 'bash', atHome)).toEqual([]);
    expect(ids('rm -rf ~', 'bash', atHome)).toEqual(['OLDMAN-G03']);
  });

  it('allows targets that depend on variables it cannot see', () => {
    expect(ids('rm -rf "$OUT_DIR"', 'bash', posix)).toEqual([]);
    expect(ids('rm -rf ${TMPDIR}/x', 'bash', posix)).toEqual([]);
    expect(ids('Remove-Item -Recurse -Force $env:TEMP\\x', 'powershell')).toEqual([]);
  });

  it('reads PowerShell parameters by their accepted abbreviations only', () => {
    expect(ids('Remove-Item -rec -forc C:\\Windows', 'powershell')).toEqual(['OLDMAN-G03']);
    expect(ids('Remove-Item -Recurse -f C:\\Windows', 'powershell')).toEqual([]);
    expect(ids('Remove-Item -Recurse -Force -lp C:\\x', 'powershell')).toEqual(['OLDMAN-G03']);
    expect(ids('Remove-Item -Recurse -Force -Include *.tmp -Path', 'powershell')).toEqual([]);
    expect(ids('Remove-Item -Recurse -Force -Exclude:keep C:\\x', 'powershell')).toEqual([
      'OLDMAN-G03',
    ]);
  });

  it('keeps bash rm and PowerShell Remove-Item apart', () => {
    expect(ids('del -Recurse -Force C:/Windows', 'bash')).toEqual([]);
    expect(ids('Remove-Item -Recurse -Force C:\\', 'bash')).toEqual([]);
    expect(ids('rm -rf C:/Windows', 'powershell')).toEqual([]);
  });

  it('names the target and the safe alternative', () => {
    const [violation] = checkCommand('rm -rf /etc', 'bash', fakeContext().context);
    expect(violation?.message).toContain('force-deleting /etc reaches outside this project');
    expect(violation?.message).toContain('Delete only paths inside the project');
  });
});

describe('OLDMAN-G04 destructive database commands', () => {
  const noUrl: FakeOptions = { env: {} };

  it('blocks when no DATABASE_URL is found anywhere', () => {
    const [violation] = checkCommand(
      'npx prisma migrate reset',
      'bash',
      fakeContext(noUrl).context,
    );
    expect(violation?.id).toBe('OLDMAN-G04');
    expect(violation?.message).toContain('no DATABASE_URL was found, so it may not be local');
  });

  it('looks in the command line, then the environment, then .env', () => {
    const local = 'postgresql://localhost/app';
    const remote = 'postgresql://app@db.example.com/app';
    const { context, calls } = fakeContext({ env: {}, dotenv: { DATABASE_URL: local } });
    expect(checkCommand('npx prisma migrate reset', 'bash', context)).toEqual([]);
    expect(calls).toEqual(['env DATABASE_URL', 'dotenv DATABASE_URL']);
    expect(
      ids('npx prisma migrate reset', 'bash', {
        env: { DATABASE_URL: remote },
        dotenv: { DATABASE_URL: local },
      }),
    ).toEqual(['OLDMAN-G04']);
    expect(
      ids(`DATABASE_URL=${local} npx prisma migrate reset`, 'bash', {
        env: { DATABASE_URL: remote },
      }),
    ).toEqual([]);
  });

  it('does not look up the URL for harmless commands', () => {
    const { context, calls } = fakeContext();
    checkCommand('npx prisma migrate dev && psql -c "SELECT 1"', 'bash', context);
    expect(calls).toEqual([]);
  });

  it.each([
    'postgresql://localhost:5432/app',
    'postgresql://app:pw@127.0.0.1/app',
    'postgresql://[::1]/app',
    'mysql://root@0.0.0.0/app',
    'postgresql://db.localhost/app',
    'postgresql:///app?host=/var/run/postgresql',
    'file:./dev.db',
  ])('counts %s as local', (url) => {
    expect(ids('npx prisma migrate reset', 'bash', { env: { DATABASE_URL: url } })).toEqual([]);
  });

  it.each(['postgresql://app@10.0.0.5/app', 'not a url', '${DATABASE_URL}'])(
    'counts %s as not local',
    (url) => {
      expect(ids('npx prisma migrate reset', 'bash', { env: { DATABASE_URL: url } })).toEqual([
        'OLDMAN-G04',
      ]);
    },
  );

  it('prefers the host or URL given to the SQL client', () => {
    const remoteEnv: FakeOptions = { env: { DATABASE_URL: 'postgresql://db.example.com/app' } };
    expect(ids('psql --host=localhost -c "DROP TABLE t"', 'bash', remoteEnv)).toEqual([]);
    expect(ids('psql -h /var/run/postgresql -c "DROP TABLE t"', 'bash', remoteEnv)).toEqual([]);
    expect(
      ids('psql --dbname=postgresql://localhost/app -c "DROP TABLE t"', 'bash', remoteEnv),
    ).toEqual([]);
    expect(
      ids('mariadb -h db.example.com -e "truncate t"', 'bash', {
        env: { DATABASE_URL: 'mysql://localhost/x' },
      }),
    ).toEqual(['OLDMAN-G04']);
    expect(
      ids('psql -c "DROP TABLE t" -h', 'bash', {
        env: { DATABASE_URL: 'postgresql://localhost/x' },
      }),
    ).toEqual([]);
  });

  it('only treats prisma as a command when run directly or through a package runner', () => {
    expect(ids('./node_modules/.bin/prisma migrate reset', 'bash')).toEqual(['OLDMAN-G04']);
    expect(ids('echo prisma migrate reset', 'bash')).toEqual([]);
    expect(ids('npx prisma db push', 'bash')).toEqual([]);
  });

  it('never prints the URL', () => {
    const secretUrl = 'postgresql://admin:hunter2@db.example.com/app';
    const [violation] = checkCommand(
      `DATABASE_URL=${secretUrl} npx prisma migrate reset`,
      'bash',
      fakeContext().context,
    );
    expect(violation?.message).not.toContain('hunter2');
    expect(violation?.message).not.toContain('db.example.com');
    expect(violation?.message).toContain('Run it against a local database');
  });
});
