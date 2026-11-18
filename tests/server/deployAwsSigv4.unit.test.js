import assert from "node:assert/strict";
import test from "node:test";

import { signRequest, signingKey } from "../../packages/vibe64-deploy/src/adapters/aws/sigv4.js";

// AWS Signature Version 4 against AWS's published test suite (aws-sig-v4-test-suite, as botocore keeps it in
// tests/unit/auth/aws4_testsuite): each case's request, canonical request, string to sign and Authorization header,
// with the suite's example credential (AWS's documentation key, not a real one), region us-east-1 and service "service".
const CREDENTIALS = Object.freeze({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" });
const DATE = new Date("2015-08-30T12:36:00Z");
const SCOPE = "Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TOKEN = "AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/"
  + "kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+"
  + "scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA==";

const CASES = [
  {
    name: "get-vanilla",
    request: { method: "GET", url: "https://example.amazonaws.com/" },
    canonical: `GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    hashed: "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31`
  },
  {
    name: "get-vanilla-query-order-key-case",
    request: { method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1" },
    canonical: `GET\n/\nParam1=value1&Param2=value2\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    hashed: "816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=host;x-amz-date, Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500`
  },
  {
    name: "post-vanilla",
    request: { method: "POST", url: "https://example.amazonaws.com/" },
    canonical: `POST\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    hashed: "553f88c9e4d10fc9e109e2aeb65f030801b70c2f6468faca261d401ae622fc87",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=host;x-amz-date, Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b`
  },
  {
    name: "post-x-www-form-urlencoded",
    request: { method: "POST", url: "https://example.amazonaws.com/", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "Param1=value1" },
    canonical: "POST\n/\n\ncontent-type:application/x-www-form-urlencoded\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\n"
      + "content-type;host;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e",
    hashed: "42a5e5bb34198acb3e84da4f085bb7927f2bc277ca766e6d19c73c2154021281",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a`
  },
  {
    name: "get-utf8",
    request: { method: "GET", url: "https://example.amazonaws.com/ሴ" },
    canonical: `GET\n/%E1%88%B4\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    hashed: "2a0a97d02205e45ce2e994789806b19270cfbbb0921b278ccf58f5249ac42102",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=host;x-amz-date, Signature=8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85`
  },
  {
    name: "get-vanilla-utf8-query",
    request: { method: "GET", url: "https://example.amazonaws.com/?ሴ=bar" },
    canonical: `GET\n/\n%E1%88%B4=bar\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`,
    hashed: "eb30c5bed55734080471a834cc727ae56beb50e5f39d1bff6d0d38cb192a7073",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=host;x-amz-date, Signature=2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04`
  },
  {
    name: "post-sts-header-before",
    request: { method: "POST", url: "https://example.amazonaws.com/" },
    sessionToken: TOKEN,
    canonical: `POST\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\nx-amz-security-token:${TOKEN}\n\nhost;x-amz-date;x-amz-security-token\n${EMPTY}`,
    hashed: "c237e1b440d4c63c32ca95b5b99481081cb7b13c7e40434868e71567c1a882f6",
    authorization: `AWS4-HMAC-SHA256 ${SCOPE}, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead`
  }
];

for (const one of CASES) {
  test(`SigV4 test suite: ${one.name}`, () => {
    const credentials = one.sessionToken ? { ...CREDENTIALS, sessionToken: one.sessionToken } : CREDENTIALS;
    const signed = signRequest({ ...one.request, service: "service", region: "us-east-1", credentials, date: DATE });
    assert.equal(signed.canonicalRequest, one.canonical);
    assert.equal(signed.stringToSign, `AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n${one.hashed}`);
    assert.equal(signed.headers.authorization, one.authorization);
    assert.equal(signed.headers["x-amz-date"], "20150830T123600Z");
    assert.equal(signed.headers["x-amz-security-token"], one.sessionToken);
    // The host is the URL's, which fetch sends itself.
    assert.equal(Object.hasOwn(signed.headers, "host"), false);
  });
}

test("the signing key of AWS's documented example (IAM, 30 Aug 2015)", () => {
  assert.equal(signingKey(CREDENTIALS.secretAccessKey, "20150830", "us-east-1", "iam").toString("hex"), "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
});

test("a request without a whole credential is refused before anything is signed", () => {
  assert.throws(() => signRequest({ method: "GET", url: "https://example.amazonaws.com/", service: "s", region: "r", credentials: { accessKeyId: "AKID" } }), /secret access key/u);
});
