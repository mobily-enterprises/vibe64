// A Deployment's services: each kind of process of the application, run as identical instances from the one build.
// At most 8; an id is a lowercase letter then up to 15 lowercase letters, digits and hyphens, since a host names its
// parts after it. Shared so a form can say so before the server refuses it.
const DEPLOYMENT_SERVICE_ID = /^[a-z][a-z0-9-]{0,15}$/u;
const DEPLOYMENT_SERVICES_MAX = 8;

export { DEPLOYMENT_SERVICE_ID, DEPLOYMENT_SERVICES_MAX };
