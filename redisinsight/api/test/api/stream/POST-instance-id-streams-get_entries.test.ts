import {
  expect,
  describe,
  it,
  before,
  deps,
  Joi,
  requirements,
  generateInvalidDataTestCases,
  validateInvalidDataTestCase,
  validateApiCall
} from '../deps';
const { server, request, constants, rte } = deps;

// endpoint to test
const endpoint = (instanceId = constants.TEST_INSTANCE_ID) =>
  request(server).post(`/instance/${instanceId}/streams/get-entries`);

const dataSchema = Joi.object({
  keyName: Joi.string().allow('').required(),
  start: Joi.string(),
  end: Joi.string(),
  count: Joi.number().integer().min(1).allow(true),
  sortOrder: Joi.string().valid('DESC', 'ASC'),
}).strict();

const validInputData = {
  keyName: constants.getRandomString(),
  start: '-',
  end: '+',
  count: 15,
  sortOrder: 'DESC',
};

const entrySchema = Joi.object().keys({
  id: Joi.string().required(),
  fields: Joi.object().required(),
});

const responseSchema = Joi.object().keys({
  keyName: Joi.string().required(),
  total: Joi.number().integer().required(),
  lastGeneratedId: Joi.string().required(),
  firstEntry: entrySchema.required(),
  lastEntry: entrySchema.required(),
  entries: Joi.array().items(entrySchema.required()).required(),
}).required();

const mainCheckFn = async (testCase) => {
  it(testCase.name, async () => {
    // additional checks before test run
    if (testCase.before) {
      await testCase.before();
    }

    await validateApiCall({
      endpoint,
      ...testCase,
    });

    // additional checks after test pass
    if (testCase.after) {
      await testCase.after();
    }
  });
};

describe('POST /instance/:instanceId/streams/get-entries', () => {
  before(async () => await rte.data.generateKeys(true));
  before(async () => await rte.data.generateHugeStream(10000, false));

  describe('Validation', () => {
    generateInvalidDataTestCases(dataSchema, validInputData).map(
      validateInvalidDataTestCase(endpoint, dataSchema),
    );
  });

  describe('Common', () => {
    let offsetEntryId;
    [
      {
        name: 'Should query 500 entries in the DESC order by default',
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
        },
        responseSchema,
        checkFn: async ({ body }) => {
          offsetEntryId = body.entries[99].id;
          expect(body.keyName).to.eql(constants.TEST_STREAM_HUGE_KEY);
          expect(body.total).to.eql(10000);
          expect(body.entries.length).to.eql(500);
          body.entries.forEach((entry, i) => {
            expect(entry.id).to.be.a('string');
            expect(entry.fields).to.eql({
              [`f_${9999 - i}`]: `v_${9999 - i}`,
            });
          });
        },
      },
      {
        name: 'Should query 10 entries in the DESC order starting from 100th entry',
        data: () => ({
          keyName: constants.TEST_STREAM_HUGE_KEY,
          start: '-',
          end: offsetEntryId,
          count: 10,
        }),
        responseSchema,
        checkFn: async ({ body }) => {
          expect(body.keyName).to.eql(constants.TEST_STREAM_HUGE_KEY);
          expect(body.total).to.eql(10000);
          expect(body.entries.length).to.eql(10);
          body.entries.forEach((entry, i) => {
            expect(entry.id).to.be.a('string');
            expect(entry.fields).to.eql({
              [`f_${9900 - i}`]: `v_${9900 - i}`,
            });
          });
        },
      },
      {
        name: 'Should query 500 entries in the ASC order',
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
          sortOrder: 'ASC',
        },
        responseSchema,
        checkFn: async ({ body }) => {
          offsetEntryId = body.entries[99].id;
          expect(body.keyName).to.eql(constants.TEST_STREAM_HUGE_KEY);
          expect(body.total).to.eql(10000);
          expect(body.entries.length).to.eql(500);
          body.entries.forEach((entry, i) => {
            expect(entry.id).to.be.a('string');
            expect(entry.fields).to.eql({
              [`f_${i}`]: `v_${i}`,
            });
          });
        },
      },
      {
        name: 'Should query 10 entries in the ASC order starting from 100th entry',
        data: () => ({
          keyName: constants.TEST_STREAM_HUGE_KEY,
          start: offsetEntryId,
          end: '+',
          count: 10,
          sortOrder: 'ASC',
        }),
        responseSchema,
        checkFn: async ({ body }) => {
          expect(body.keyName).to.eql(constants.TEST_STREAM_HUGE_KEY);
          expect(body.total).to.eql(10000);
          expect(body.entries.length).to.eql(10);
          body.entries.forEach((entry, i) => {
            expect(entry.id).to.be.a('string');
            expect(entry.fields).to.eql({
              [`f_${99 + i}`]: `v_${99 + i}`,
            });
          });
        },
      },
      {
        name: 'Should return BadRequest when try to work with non-stream type',
        data: {
          keyName: constants.TEST_STRING_KEY_1,
        },
        statusCode: 400,
        responseBody: {
          statusCode: 400,
          error: 'Bad Request',
        },
      },
      {
        name: 'Should return NotFound error if key does not exists',
        data: {
          keyName: constants.getRandomString(),
        },
        statusCode: 404,
        responseBody: {
          statusCode: 404,
          error: 'Not Found',
          message: 'Key with this name does not exist.',
        },
      },
      {
        name: 'Should return bad request',
        data: {
          keyName: constants.getRandomString(),
        },
        statusCode: 404,
        responseBody: {
          statusCode: 404,
          error: 'Not Found',
          message: 'Key with this name does not exist.',
        },
      },
      {
        name: 'Should return NotFound error if instance id does not exists',
        endpoint: () => endpoint(constants.TEST_NOT_EXISTED_INSTANCE_ID),
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
          offset: 45,
          count: 45,
          sortOrder: 'ASC',
        },
        statusCode: 404,
        responseBody: {
          statusCode: 404,
          error: 'Not Found',
          message: 'Invalid database instance id.',
        },
      },
    ].map(mainCheckFn);
  });

  describe('ACL', () => {
    requirements('rte.acl');
    before(async () => rte.data.setAclUserRules('~* +@all'));

    [
      {
        name: 'Should remove all members and key',
        endpoint: () => endpoint(constants.TEST_INSTANCE_ACL_ID),
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
          offset: 0,
          count: 15,
          sortOrder: 'ASC',
        },
        responseSchema,
      },
      {
        name: 'Should throw error if no permissions for "xinfo" command',
        endpoint: () => endpoint(constants.TEST_INSTANCE_ACL_ID),
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
          offset: 0,
          count: 15,
          sortOrder: 'ASC',
        },
        statusCode: 403,
        responseBody: {
          statusCode: 403,
          error: 'Forbidden',
        },
        before: () => rte.data.setAclUserRules('~* +@all -xinfo')
      },
      {
        name: 'Should throw error if no permissions for "xrange" command',
        endpoint: () => endpoint(constants.TEST_INSTANCE_ACL_ID),
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
          offset: 0,
          count: 15,
          sortOrder: 'ASC',
        },
        statusCode: 403,
        responseBody: {
          statusCode: 403,
          error: 'Forbidden',
        },
        before: () => rte.data.setAclUserRules('~* +@all -xrange')
      },
      {
        name: 'Should throw error if no permissions for "xrevrange" command',
        endpoint: () => endpoint(constants.TEST_INSTANCE_ACL_ID),
        data: {
          keyName: constants.TEST_STREAM_HUGE_KEY,
          offset: 0,
          count: 15,
          sortOrder: 'DESC',
        },
        statusCode: 403,
        responseBody: {
          statusCode: 403,
          error: 'Forbidden',
        },
        before: () => rte.data.setAclUserRules('~* +@all -xrevrange')
      },
    ].map(mainCheckFn);
  });
});
