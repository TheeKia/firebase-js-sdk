/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { assert } from 'chai';
import { FbsBlob } from '../../src/implementation/blob';
import { Location } from '../../src/implementation/location';
import {
  getMappings,
  fromResourceString
} from '../../src/implementation/metadata';
import {
  getMetadata,
  list,
  getDownloadUrl,
  updateMetadata,
  deleteObject,
  multipartUpload,
  createResumableUpload,
  getResumableUploadStatus,
  ResumableUploadStatus,
  continueResumableUpload,
  RESUMABLE_UPLOAD_CHUNK_SIZE,
  getBytes
} from '../../src/implementation/requests';
import { makeUrl } from '../../src/implementation/url';
import { unknown, StorageErrorCode } from '../../src/implementation/error';
import { RequestInfo } from '../../src/implementation/requestinfo';
import { Metadata } from '../../src/metadata';
import { FirebaseStorageImpl } from '../../src/service';
import {
  assertObjectIncludes,
  fakeXhrIo,
  fakeAuthProvider,
  fakeAppCheckTokenProvider
} from './testshared';
import {
  DEFAULT_HOST,
  CONFIG_STORAGE_BUCKET_KEY
} from '../../src/implementation/constants';
import { FirebaseApp } from '@firebase/app-types';
import { decodeUint8Array } from '../../src/platform/base64';

describe('Firebase Storage > Requests', () => {
  const normalBucket = 'b';
  const differentBucket = 'c';
  const locationRoot = new Location(normalBucket, '');
  const locationNormal = new Location(normalBucket, 'o');
  const locationNormalUrl = '/b/' + normalBucket + '/o/o';
  const locationDifferentBucket = new Location(differentBucket, '');
  const locationNormalNoObjUrl = '/b/' + normalBucket + '/o';
  const locationEscapes = new Location('b/', 'o?');
  const locationEscapesUrl = '/b/b%2F/o/o%3F';
  const locationEscapesNoObjUrl = '/b/b%2F/o';
  const smallBlob = new FbsBlob(new Uint8Array([97]));
  const smallBlobString = 'a';
  const bigBlob = new FbsBlob(new ArrayBuffer(1024 * 1024));

  const mappings = getMappings();

  const mockApp: FirebaseApp = {
    name: 'mock-app',
    options: {
      [CONFIG_STORAGE_BUCKET_KEY]: 'fredzqm-staging'
    },
    automaticDataCollectionEnabled: false,
    delete: async () => undefined
  };

  const storageService = new FirebaseStorageImpl(
    mockApp,
    fakeAuthProvider,
    fakeAppCheckTokenProvider
  );

  const contentTypeInMetadata = 'application/jason';
  const metadata = {
    contentType: contentTypeInMetadata,
    customMetadata: {
      // no-inline
      foo: 'bar'
    }
  } as any as Metadata;
  const metadataString = JSON.stringify({
    // no-inline
    contentType: contentTypeInMetadata,
    metadata: {
      // no-inline
      foo: 'bar'
    }
  });

  const serverResource = {
    bucket: normalBucket,
    generation: '1',
    metageneration: '2',

    name: 'foo/bar/baz.png',

    size: '10',
    timeCreated: 'This is a real time',
    updated: 'Also a real time',
    md5Hash: 'deadbeef',

    cacheControl: 'max-age=604800',
    contentDisposition: 'Attachment; filename=baz.png',
    contentLanguage: 'en-US',
    contentType: 'application/jason',

    downloadTokens: 'a,b,c',
    metadata: { foo: 'bar' }
  };
  const serverResourceString = JSON.stringify(serverResource);
  const metadataFromServerResource = fromResourceString(
    storageService,
    serverResourceString,
    mappings
  );
  const downloadUrlFromServerResource =
    `https://${DEFAULT_HOST}/v0/b/` +
    normalBucket +
    '/o/' +
    encodeURIComponent(serverResource.name) +
    '?alt=media&token=a';

  function uploadMetadataString(name: string): string {
    return JSON.stringify({
      name,
      contentType: contentTypeInMetadata,
      metadata: { foo: 'bar' }
    });
  }

  const metadataContentType = 'application/json; charset=utf-8';

  function readBlob(blob: Blob): Promise<string> {
    const reader = new FileReader();
    reader.readAsText(blob);
    return new Promise((resolve, reject) => {
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => {
        reject(reader.error as Error);
      };
    });
  }

  async function assertBodyEquals(
    body: Blob | string | Uint8Array | null,
    expectedStr: string
  ): Promise<void> {
    if (body === null) {
      assert.fail('body was null');
    }

    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return readBlob(body).then(str => {
        assert.equal(str, expectedStr);
      });
    } else if (body instanceof Uint8Array) {
      const str = decodeUint8Array(body);
      assert.equal(str, expectedStr);
    } else {
      assert.equal(body as string, expectedStr);
      return Promise.resolve(undefined);
    }
  }

  function checkMetadataHandler(
    requestInfo: RequestInfo<string, Metadata>
  ): void {
    const metadata = requestInfo.handler(fakeXhrIo({}), serverResourceString);
    assert.deepEqual(metadata, metadataFromServerResource);
  }

  function checkNoOpHandler<T>(requestInfo: RequestInfo<string, T>): void {
    try {
      requestInfo.handler(fakeXhrIo({}), '');
    } catch (e) {
      assert.fail('Remove handler threw');
    }
  }

  it('getMetadata request info', () => {
    const maps: Array<[Location, string]> = [
      [locationNormal, locationNormalUrl],
      [locationEscapes, locationEscapesUrl]
    ];
    for (const [location, url] of maps) {
      const requestInfo = getMetadata(storageService, location, mappings);
      assertObjectIncludes(
        {
          url: makeUrl(url, storageService.host, storageService._protocol),
          method: 'GET',
          body: null,
          headers: {},
          urlParams: {}
        },
        requestInfo
      );
    }
  });

  it('getMetadata handler', () => {
    const requestInfo = getMetadata(storageService, locationNormal, mappings);
    checkMetadataHandler(requestInfo);
  });

  it('list root request info', () => {
    const requestInfo = list(storageService, locationRoot, '/');
    assertObjectIncludes(
      {
        url: makeUrl(
          locationNormalNoObjUrl,
          storageService.host,
          storageService._protocol
        ),
        method: 'GET',
        body: null,
        headers: {},
        urlParams: {
          prefix: '',
          delimiter: '/'
        }
      },
      requestInfo
    );
  });

  it('list request info', () => {
    const maps: Array<[Location, string]> = [
      [locationNormal, locationNormalNoObjUrl],
      [locationEscapes, locationEscapesNoObjUrl]
    ];
    const pageToken = 'pageToken-afeafeagef';
    const maxResults = 13;
    for (const [location, locationNoObjectUrl] of maps) {
      const requestInfo = list(
        storageService,
        location,
        '/',
        pageToken,
        maxResults
      );
      assertObjectIncludes(
        {
          url: makeUrl(
            locationNoObjectUrl,
            storageService.host,
            storageService._protocol
          ),
          method: 'GET',
          body: null,
          headers: {},
          urlParams: {
            prefix: location.path + '/',
            delimiter: '/',
            pageToken,
            maxResults
          }
        },
        requestInfo
      );
    }
  });

  it('list handler', () => {
    const requestInfo = list(storageService, locationNormal);
    const pageToken = 'YS9mLw==';
    const listResponse = {
      prefixes: ['a/f/'],
      items: [
        {
          name: 'a/a',
          bucket: normalBucket
        },
        {
          name: 'a/b',
          bucket: normalBucket
        }
      ],
      nextPageToken: pageToken
    };
    const listResponseString = JSON.stringify(listResponse);
    const listResult = requestInfo.handler(fakeXhrIo({}), listResponseString);
    assert.equal(listResult.prefixes[0].fullPath, 'a/f');
    assert.equal(listResult.items[0].fullPath, 'a/a');
    assert.equal(listResult.items[1].fullPath, 'a/b');
    assert.equal(listResult.nextPageToken, pageToken);
  });

  it('list handler with custom bucket', () => {
    const requestInfo = list(storageService, locationDifferentBucket);
    const pageToken = 'YS9mLw==';
    const listResponse = {
      items: [
        {
          name: 'a/a',
          bucket: differentBucket
        }
      ],
      nextPageToken: pageToken
    };
    const listResponseString = JSON.stringify(listResponse);
    const listResult = requestInfo.handler(fakeXhrIo({}), listResponseString);
    assert.equal(listResult.items[0].bucket, differentBucket);
  });

  it('getDownloadUrl request info', () => {
    const maps: Array<[Location, string]> = [
      [locationNormal, locationNormalUrl],
      [locationEscapes, locationEscapesUrl]
    ];
    for (const [location, url] of maps) {
      const requestInfo = getDownloadUrl(storageService, location, mappings);
      assertObjectIncludes(
        {
          url: makeUrl(url, storageService.host, storageService._protocol),
          method: 'GET',
          body: null,
          headers: {},
          urlParams: {}
        },
        requestInfo
      );
    }
  });
  it('getDownloadUrl handler', () => {
    const requestInfo = getDownloadUrl(
      storageService,
      locationNormal,
      mappings
    );
    const url = requestInfo.handler(fakeXhrIo({}), serverResourceString);
    assert.equal(url, downloadUrlFromServerResource);
  });
  it('getBytes handler', () => {
    const requestInfo = getBytes(storageService, locationNormal);
    const bytes = requestInfo.handler(
      fakeXhrIo({}),
      new Uint8Array([1, 128, 255])
    ) as ArrayBuffer; // Narrow type to ArrayBuffer
    assert.deepEqual(new Uint8Array(bytes), new Uint8Array([1, 128, 255]));
  });
  it('updateMetadata requestinfo', () => {
    const maps = [
      [locationNormal, locationNormalUrl],
      [locationEscapes, locationEscapesUrl]
    ];
    for (let i = 0; i < maps.length; i++) {
      const location = maps[i][0] as Location;
      const url = maps[i][1] as string;
      const requestInfo = updateMetadata(
        storageService,
        location,
        metadata,
        mappings
      );
      assertObjectIncludes(
        {
          url: makeUrl(url, storageService.host, storageService._protocol),
          method: 'PATCH',
          body: metadataString,
          headers: { 'Content-Type': metadataContentType },
          urlParams: {}
        },
        requestInfo
      );
    }
  });
  it('updateMetadata handler', () => {
    const requestInfo = updateMetadata(
      storageService,
      locationNormal,
      metadata,
      mappings
    );
    checkMetadataHandler(requestInfo);
  });

  it('deleteObject request info', () => {
    const maps = [
      [locationNormal, locationNormalUrl],
      [locationEscapes, locationEscapesUrl]
    ];
    for (let i = 0; i < maps.length; i++) {
      const location = maps[i][0] as Location;
      const url = maps[i][1] as string;
      const requestInfo = deleteObject(storageService, location);
      assertObjectIncludes(
        {
          url: makeUrl(url, storageService.host, storageService._protocol),
          method: 'DELETE',
          body: null,
          headers: {},
          urlParams: {}
        },
        requestInfo
      );
    }
  });
  it('deleteObject handler', () => {
    const requestInfo = deleteObject(storageService, locationNormal);
    checkNoOpHandler(requestInfo);
  });
  it('multipartUpload request info', () => {
    const multipartHeaderRegex =
      /^multipart\/related; boundary=([A-Za-z0-9]+)$/;

    const maps = [
      [locationNormal, locationNormalNoObjUrl],
      [locationEscapes, locationEscapesNoObjUrl]
    ];
    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < maps.length; i++) {
      const location = maps[i][0] as Location;
      const url = maps[i][1] as string;
      const makeMultipartBodyString = (boundary: string): string => {
        return (
          '--' +
          boundary +
          '\r\n' +
          'Content-Type: ' +
          metadataContentType +
          '\r\n\r\n' +
          uploadMetadataString(location.path) +
          '\r\n--' +
          boundary +
          '\r\n' +
          'Content-Type: ' +
          contentTypeInMetadata +
          '\r\n\r\n' +
          smallBlobString +
          '\r\n--' +
          boundary +
          '--'
        );
      };
      const requestInfo = multipartUpload(
        storageService,
        location,
        mappings,
        smallBlob,
        metadata
      );
      const matches = (requestInfo.headers['Content-Type'] as string).match(
        multipartHeaderRegex
      );
      assert.isNotNull(matches);
      assert.equal(matches!.length, 2);
      const boundary = matches![1];
      promises.push(
        assertBodyEquals(requestInfo.body, makeMultipartBodyString(boundary))
      );

      assertObjectIncludes(
        {
          url: makeUrl(url, storageService.host, storageService._protocol),
          method: 'POST',
          urlParams: { name: location.path },
          headers: {
            'X-Goog-Upload-Protocol': 'multipart',
            // Checked before this block, but needed here because
            // assertObjectIncludes does exact checks on values.
            'Content-Type': requestInfo.headers['Content-Type']
          }
        },
        requestInfo
      );
    }

    return Promise.all(promises);
  });
  it('multipartUpload handler', () => {
    const requestInfo = multipartUpload(
      storageService,
      locationNormal,
      mappings,
      smallBlob,
      metadata
    );
    checkMetadataHandler(requestInfo);
  });

  it('createResumableUpload request info', () => {
    const maps = [
      [locationNormal, locationNormalNoObjUrl],
      [locationEscapes, locationEscapesNoObjUrl]
    ];
    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < maps.length; i++) {
      const location = maps[i][0] as Location;
      const url = maps[i][1] as string;
      const requestInfo = createResumableUpload(
        storageService,
        location,
        mappings,
        smallBlob,
        metadata
      );
      assertObjectIncludes(
        {
          url: makeUrl(url, storageService.host, storageService._protocol),
          method: 'POST',
          urlParams: { name: location.path },
          headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': `${smallBlob.size()}`,
            'X-Goog-Upload-Header-Content-Type': contentTypeInMetadata,
            'Content-Type': metadataContentType
          }
        },
        requestInfo
      );
      promises.push(
        assertBodyEquals(requestInfo.body, uploadMetadataString(location.path))
      );
    }
    return Promise.all(promises);
  });

  function _testCreateResumableUploadHandler(): void {
    const requestInfo = createResumableUpload(
      storageService,
      locationNormal,
      mappings,
      smallBlob,
      metadata
    );
    const uploadUrl = 'https://i.am.an.upload.url.com/hello/there';

    const handlerUrl = requestInfo.handler(
      fakeXhrIo({
        'X-Goog-Upload-Status': 'active',
        'X-Goog-Upload-URL': uploadUrl
      }),
      ''
    );

    assert.equal(handlerUrl, uploadUrl);
  }
  it('getResumableUploadStatus request info', () => {
    const url =
      'https://this.is.totally.a.real.url.com/hello/upload?whatsgoingon';
    const requestInfo = getResumableUploadStatus(
      storageService,
      locationNormal,
      url,
      smallBlob
    );
    assertObjectIncludes(
      {
        url,
        method: 'POST',
        urlParams: {},
        headers: { 'X-Goog-Upload-Command': 'query' }
      },
      requestInfo
    );
  });
  describe('getResumableUploadStatus handler', () => {
    const url =
      'https://this.is.totally.a.real.url.com/hello/upload?whatsgoingon';
    const requestInfo = getResumableUploadStatus(
      storageService,
      locationNormal,
      url,
      smallBlob
    );

    let status = requestInfo.handler(
      fakeXhrIo({
        'X-Goog-Upload-Status': 'active',
        'X-Goog-Upload-Size-Received': '0'
      }),
      ''
    );
    let expectedStatus = new ResumableUploadStatus(0, smallBlob.size(), false);
    assert.deepEqual(status, expectedStatus);

    status = requestInfo.handler(
      fakeXhrIo({
        'X-Goog-Upload-Status': 'final',
        'X-Goog-Upload-Size-Received': '' + smallBlob.size()
      }),
      ''
    );
    expectedStatus = new ResumableUploadStatus(
      smallBlob.size(),
      smallBlob.size(),
      true
    );
    assert.deepEqual(status, expectedStatus);
  });
  it('continueResumableUpload request info', () => {
    const url =
      'https://this.is.totally.a.real.url.com/hello/upload?whatsgoingon';
    const requestInfo = continueResumableUpload(
      locationNormal,
      storageService,
      url,
      smallBlob,
      RESUMABLE_UPLOAD_CHUNK_SIZE,
      mappings
    );
    assertObjectIncludes(
      {
        url,
        method: 'POST',
        urlParams: {},
        headers: {
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0'
        }
      },
      requestInfo
    );

    return assertBodyEquals(requestInfo.body, smallBlobString);
  });
  it('populates requestInfo with the upload command when more chunks are left', () => {
    const url =
      'https://this.is.totally.a.real.url.com/hello/upload?whatsgoingon';
    const requestInfo = continueResumableUpload(
      locationNormal,
      storageService,
      url,
      bigBlob,
      RESUMABLE_UPLOAD_CHUNK_SIZE,
      mappings
    );
    assertObjectIncludes(
      {
        url,
        method: 'POST',
        urlParams: {},
        headers: {
          'X-Goog-Upload-Command': 'upload',
          'X-Goog-Upload-Offset': '0'
        }
      },
      requestInfo
    );

    assert.deepEqual(
      requestInfo.body,
      bigBlob.slice(0, RESUMABLE_UPLOAD_CHUNK_SIZE)!.uploadData()
    );
  });
  it('populates requestInfo with just the finalize command when no more data needs to be uploaded', () => {
    const url =
      'https://this.is.totally.a.real.url.com/hello/upload?whatsgoingon';
    const blobSize = bigBlob.size();
    const requestInfo = continueResumableUpload(
      locationNormal,
      storageService,
      url,
      bigBlob,
      RESUMABLE_UPLOAD_CHUNK_SIZE,
      mappings,
      {
        current: blobSize,
        total: blobSize,
        finalized: false,
        metadata: null
      }
    );
    assertObjectIncludes(
      {
        url,
        method: 'POST',
        urlParams: {},
        headers: {
          'X-Goog-Upload-Command': 'finalize',
          'X-Goog-Upload-Offset': blobSize.toString()
        }
      },
      requestInfo
    );

    assert.deepEqual(
      requestInfo.body,
      bigBlob.slice(blobSize, blobSize)!.uploadData()
    );
  });
  it('continueResumableUpload handler', () => {
    const url =
      'https://this.is.totally.a.real.url.com/hello/upload?whatsgoingon';
    const chunkSize = RESUMABLE_UPLOAD_CHUNK_SIZE;

    assert.isTrue(smallBlob.size() < chunkSize);
    let requestInfo = continueResumableUpload(
      locationNormal,
      storageService,
      url,
      smallBlob,
      chunkSize,
      mappings
    );
    let status = requestInfo.handler(
      fakeXhrIo({ 'X-Goog-Upload-Status': 'final' }),
      serverResourceString
    );
    let expectedStatus = new ResumableUploadStatus(
      smallBlob.size(),
      smallBlob.size(),
      true,
      metadataFromServerResource
    );
    assert.deepEqual(status, expectedStatus);

    assert.isTrue(bigBlob.size() > chunkSize);
    requestInfo = continueResumableUpload(
      locationNormal,
      storageService,
      url,
      bigBlob,
      chunkSize,
      mappings
    );
    status = requestInfo.handler(
      fakeXhrIo({ 'X-Goog-Upload-Status': 'active' }),
      ''
    );
    expectedStatus = new ResumableUploadStatus(
      chunkSize,
      bigBlob.size(),
      false
    );
    assert.deepEqual(status, expectedStatus);
  });

  it('error handler passes through unknown errors', () => {
    const requestInfo = getMetadata(storageService, locationNormal, mappings);
    const error = unknown();
    const resultError = requestInfo.errorHandler!(fakeXhrIo({}, 509), error);
    assert.equal(resultError, error);
  });
  it('error handler converts 404 to not found', () => {
    const requestInfo = getMetadata(storageService, locationNormal, mappings);
    const error = unknown();
    const resultError = requestInfo.errorHandler!(fakeXhrIo({}, 404), error);
    assert.isTrue(resultError._codeEquals(StorageErrorCode.OBJECT_NOT_FOUND));
  });
  it('error handler converts 402 to quota exceeded', () => {
    const requestInfo = getMetadata(storageService, locationNormal, mappings);
    const error = unknown();
    const resultError = requestInfo.errorHandler!(fakeXhrIo({}, 402), error);
    assert.isTrue(resultError._codeEquals(StorageErrorCode.QUOTA_EXCEEDED));
  });
});
