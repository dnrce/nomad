import { currentURL, visit } from '@ember/test-helpers';
import { Promise } from 'rsvp';
import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import moment from 'moment';

import setupMirage from 'ember-cli-mirage/test-support/setup-mirage';
import Response from 'ember-cli-mirage/response';

import { formatBytes } from 'nomad-ui/helpers/format-bytes';
import { filesForPath } from 'nomad-ui/mirage/config';

import browseFilesystem from './behaviors/fs';

import FS from 'nomad-ui/tests/pages/allocations/task/fs';

let allocation;
let allocationShortId;
let files;

const fileSort = (prop, files) => {
  let dir = [];
  let file = [];
  files.forEach(f => {
    if (f.isDir) {
      dir.push(f);
    } else {
      file.push(f);
    }
  });

  return dir.sortBy(prop).concat(file.sortBy(prop));
};

module('Acceptance | allocation fs', function(hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function() {
    server.create('agent');
    server.create('node', 'forceIPv4');
    const job = server.create('job', { createAllocations: false });

    allocation = server.create('allocation', { jobId: job.id, clientStatus: 'running' });
    allocationShortId = allocation.id.split('-')[0];

    this.allocation = allocation;

    // Reset files
    files = [];

    // Nested files
    files.push(server.create('allocFile', { isDir: true, name: 'directory' }));
    files.push(server.create('allocFile', { isDir: true, name: 'another', parent: files[0] }));
    files.push(
      server.create('allocFile', 'file', {
        name: 'something.txt',
        fileType: 'txt',
        parent: files[1],
      })
    );

    files.push(server.create('allocFile', { isDir: true, name: 'empty-directory' }));
    files.push(server.create('allocFile', 'file', { fileType: 'txt' }));
    files.push(server.create('allocFile', 'file', { fileType: 'txt' }));
  });

  test('visiting /allocations/:allocation_id/fs', async function(assert) {
    await FS.visitAllocation({ id: allocation.id  });
    assert.equal(currentURL(), `/allocations/${allocation.id}/fs`, 'No redirect');
  });

  test('when the allocation is not running, an empty state is shown', async function(assert) {
    // The API 500s on stat when not running
    this.server.get('/client/fs/stat/:allocation_id', () => {
      return new Response(500, {}, 'no such file or directory');
    });

    allocation.update({
      clientStatus: 'complete',
    });

    await FS.visitAllocation({ id: allocation.id });
    assert.ok(FS.hasEmptyState, 'Non-running allocation has no files');
    assert.ok(
      FS.emptyState.headline.includes('Allocation is not Running'),
      'Empty state explains the condition'
    );
  });

  browseFilesystem({
    visitSegments: ({ allocation }) => ({ id: allocation.id }),
    getExpectedPathBase: ({ allocation }) => `/allocations/${allocation.id}/fs/`,
    getTitleComponent: ({ allocation }) => `Allocation ${allocation.id.split('-')[0]} filesystem`,
    getBreadcrumbComponent: ({ allocation }) => allocation.id.split('-')[0],
    pageObjectVisitPathFunctionName: 'visitAllocationPath',
  });

  test('navigating allocation filesystem', async function(assert) {
    await FS.visitAllocationPath({ id: allocation.id, path: '/' });

    const sortedFiles = fileSort('name', filesForPath(this.server.schema.allocFiles, '').models);

    assert.ok(FS.fileViewer.isHidden);

    assert.equal(FS.directoryEntries.length, 4);

    assert.equal(FS.breadcrumbsText, allocationShortId);

    assert.equal(FS.breadcrumbs.length, 1);
    assert.ok(FS.breadcrumbs[0].isActive);
    assert.equal(FS.breadcrumbs[0].text, allocationShortId);

    FS.directoryEntries[0].as(directory => {
      const fileRecord = sortedFiles[0];
      assert.equal(directory.name, fileRecord.name, 'directories should come first');
      assert.ok(directory.isDirectory);
      assert.equal(directory.size, '', 'directory sizes are hidden');
      assert.equal(directory.lastModified, moment(fileRecord.modTime).fromNow());
      assert.notOk(directory.path.includes('//'), 'paths shouldn’t have redundant separators');
    });

    FS.directoryEntries[2].as(file => {
      const fileRecord = sortedFiles[2];
      assert.equal(file.name, fileRecord.name);
      assert.ok(file.isFile);
      assert.equal(file.size, formatBytes([fileRecord.size]));
      assert.equal(file.lastModified, moment(fileRecord.modTime).fromNow());
    });

    await FS.directoryEntries[0].visit();

    assert.equal(FS.directoryEntries.length, 1);

    assert.equal(FS.breadcrumbs.length, 2);
    assert.equal(FS.breadcrumbsText, `${allocationShortId} ${files[0].name}`);

    assert.notOk(FS.breadcrumbs[0].isActive);

    assert.equal(FS.breadcrumbs[1].text, files[0].name);
    assert.ok(FS.breadcrumbs[1].isActive);

    await FS.directoryEntries[0].visit();

    assert.equal(FS.directoryEntries.length, 1);
    assert.notOk(
      FS.directoryEntries[0].path.includes('//'),
      'paths shouldn’t have redundant separators'
    );

    assert.equal(FS.breadcrumbs.length, 3);
    assert.equal(FS.breadcrumbsText, `${allocationShortId} ${files[0].name} ${files[1].name}`);
    assert.equal(FS.breadcrumbs[2].text, files[1].name);

    assert.notOk(
      FS.breadcrumbs[0].path.includes('//'),
      'paths shouldn’t have redundant separators'
    );
    assert.notOk(
      FS.breadcrumbs[1].path.includes('//'),
      'paths shouldn’t have redundant separators'
    );

    await FS.breadcrumbs[1].visit();
    assert.equal(FS.breadcrumbsText, `${allocationShortId} ${files[0].name}`);
    assert.equal(FS.breadcrumbs.length, 2);
  });

  test('sorting allocation filesystem directory', async function(assert) {
    this.server.get('/client/fs/ls/:allocation_id', () => {
      return [
        {
          Name: 'aaa-big-old-file',
          IsDir: false,
          Size: 19190000,
          ModTime: moment()
            .subtract(1, 'year')
            .format(),
        },
        {
          Name: 'mmm-small-mid-file',
          IsDir: false,
          Size: 1919,
          ModTime: moment()
            .subtract(6, 'month')
            .format(),
        },
        {
          Name: 'zzz-med-new-file',
          IsDir: false,
          Size: 191900,
          ModTime: moment().format(),
        },
        {
          Name: 'aaa-big-old-directory',
          IsDir: true,
          Size: 19190000,
          ModTime: moment()
            .subtract(1, 'year')
            .format(),
        },
        {
          Name: 'mmm-small-mid-directory',
          IsDir: true,
          Size: 1919,
          ModTime: moment()
            .subtract(6, 'month')
            .format(),
        },
        {
          Name: 'zzz-med-new-directory',
          IsDir: true,
          Size: 191900,
          ModTime: moment().format(),
        },
      ];
    });

    await FS.visitAllocationPath({ id: allocation.id, path: '/' });

    assert.deepEqual(FS.directoryEntryNames(), [
      'aaa-big-old-directory',
      'mmm-small-mid-directory',
      'zzz-med-new-directory',
      'aaa-big-old-file',
      'mmm-small-mid-file',
      'zzz-med-new-file',
    ]);

    await FS.sortBy('Name');

    assert.deepEqual(FS.directoryEntryNames(), [
      'zzz-med-new-file',
      'mmm-small-mid-file',
      'aaa-big-old-file',
      'zzz-med-new-directory',
      'mmm-small-mid-directory',
      'aaa-big-old-directory',
    ]);

    await FS.sortBy('ModTime');

    assert.deepEqual(FS.directoryEntryNames(), [
      'zzz-med-new-file',
      'mmm-small-mid-file',
      'aaa-big-old-file',
      'zzz-med-new-directory',
      'mmm-small-mid-directory',
      'aaa-big-old-directory',
    ]);

    await FS.sortBy('ModTime');

    assert.deepEqual(FS.directoryEntryNames(), [
      'aaa-big-old-directory',
      'mmm-small-mid-directory',
      'zzz-med-new-directory',
      'aaa-big-old-file',
      'mmm-small-mid-file',
      'zzz-med-new-file',
    ]);

    await FS.sortBy('Size');

    assert.deepEqual(
      FS.directoryEntryNames(),
      [
        'aaa-big-old-file',
        'zzz-med-new-file',
        'mmm-small-mid-file',
        'zzz-med-new-directory',
        'mmm-small-mid-directory',
        'aaa-big-old-directory',
      ],
      'expected files to be sorted by descending size and directories to be sorted by descending name'
    );

    await FS.sortBy('Size');

    assert.deepEqual(
      FS.directoryEntryNames(),
      [
        'aaa-big-old-directory',
        'mmm-small-mid-directory',
        'zzz-med-new-directory',
        'mmm-small-mid-file',
        'zzz-med-new-file',
        'aaa-big-old-file',
      ],
      'expected directories to be sorted by name and files to be sorted by ascending size'
    );
  });

  test('viewing a file', async function(assert) {
    const node = server.db.nodes.find(allocation.nodeId);

    server.get(`http://${node.httpAddr}/v1/client/fs/readat/:allocation_id`, function() {
      return new Response(500);
    });

    await FS.visitAllocationPath({ id: allocation.id, path: '/' });

    const sortedFiles = fileSort('name', filesForPath(this.server.schema.allocFiles, '').models);
    const fileRecord = sortedFiles.find(f => !f.isDir);
    const fileIndex = sortedFiles.indexOf(fileRecord);

    await FS.directoryEntries[fileIndex].visit();

    assert.equal(FS.breadcrumbsText, `${allocationShortId} ${fileRecord.name}`);

    assert.ok(FS.fileViewer.isPresent);

    const requests = this.server.pretender.handledRequests;
    const secondAttempt = requests.pop();
    const firstAttempt = requests.pop();

    assert.equal(
      firstAttempt.url.split('?')[0],
      `//${node.httpAddr}/v1/client/fs/readat/${allocation.id}`,
      'Client is hit first'
    );
    assert.equal(firstAttempt.status, 500, 'Client request fails');
    assert.equal(
      secondAttempt.url.split('?')[0],
      `/v1/client/fs/readat/${allocation.id}`,
      'Server is hit second'
    );
  });

  test('viewing an empty directory', async function(assert) {
    await FS.visitAllocationPath({ id: allocation.id, path: 'empty-directory' });

    assert.ok(FS.isEmptyDirectory);
  });

  test('viewing paths that produce stat API errors', async function(assert) {
    this.server.get('/client/fs/stat/:allocation_id', () => {
      return new Response(500, {}, 'no such file or directory');
    });

    await FS.visitAllocationPath({ id: allocation.id, path: '/what-is-this' });
    assert.equal(FS.error.title, 'Not Found', '500 is interpreted as 404');

    await visit('/');

    this.server.get('/client/fs/stat/:allocation_id', () => {
      return new Response(999);
    });

    await FS.visitAllocationPath({ id: allocation.id, path: '/what-is-this' });
    assert.equal(FS.error.title, 'Error', 'other statuses are passed through');
  });

  test('viewing paths that produce ls API errors', async function(assert) {
    this.server.get('/client/fs/ls/:allocation_id', () => {
      return new Response(500, {}, 'no such file or directory');
    });

    await FS.visitAllocationPath({ id: allocation.id, path: files[0].name });
    assert.equal(FS.error.title, 'Not Found', '500 is interpreted as 404');

    await visit('/');

    this.server.get('/client/fs/ls/:allocation_id', () => {
      return new Response(999);
    });

    await FS.visitAllocationPath({ id: allocation.id, path: files[0].name });
    assert.equal(FS.error.title, 'Error', 'other statuses are passed through');
  });
});
