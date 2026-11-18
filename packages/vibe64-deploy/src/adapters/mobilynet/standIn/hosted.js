import {
  CATALOGUE, HOST_REGIONS, MACHINE_SIZES, REGIONS, catalogueApp, interfaceNamed, isRecord, labelsMatch, labelsOf,
  needSettings, needValues, newCredential, pageOf, projectLabel, randomText
} from "./catalogue.js";

// mobilynet's hosted services as its stand-in answers them (openApiHosted.js, and its machines package's
// hostedServices.js, hostedLinks.js and hostedValues.js, with the catalogue's four apps): a catalogue app run on a
// machine of its own in a mobilynet project, its connection the interface it provides, reached by links. A create (an
// Idempotency-Key required) answers `202 { hostedService, links, operation }`, `creating`, each link's secret fields
// shown this once; the hosted service runs (health `healthy`) when the stand-in moves on, and a link is `issuing` until
// its hosted service runs, then `active`. A hosted service holds several links, one per need of each consumer. A link
// gives its consumer its need's settings (`<AS>_<FIELD>`, secret fields as secrets) as it is made, through a settings
// refresh of the App Service (services.js linkSettings), and takes them out as it is removed (`revoking`, then
// `revoked`). A link is checked against the release its consumer runs or, when that names no such need, the release
// its refresh ahead moves it to, the refresh in progress (engine-support M14, mobilynet feat/engine-support): its
// settings then go into that refresh and the changes of settings queued behind it (services.js linkSettingsAhead), and
// should that refresh fail, the link ends as a deleted consumer's does, its settings out of those changes. While a move
// can't be checked yet (its refresh queued), such a link is refused `422`, to be tried again once that refresh builds.
// A delete is refused `409 hosted_service_linked` while links are held, unless `?links=revoke` ends them with it. A
// size change resizes its machine (`202`, `resizing`, then running again), or answers `200` with no operation when its
// machine already is that size. Labels (engine-support M2) are set at create and replaced whole by a PATCH (`200`, no
// operation, when nothing else changes), and a list filters by them. Its machine counts against the project's
// machines, vCPU, memory and disk quotas, and a project at its spending cap makes none and resizes none up (M12, M13:
// `world.admit`). Faults: `neverBoots` (a hosted service stays `creating`) and `noCapacity`.
// STAND-IN ONLY: a link's consumer is an App Service alone (a VPS's app or another hosted service is refused `422`); a
// link makes no allow rule; a restore (`fromBackup`) is refused; an operation is answered within the hosted service's
// answers only; health has no metrics, and backups are on with no point yet.

const MACHINE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const HELD = Object.freeze(["issuing", "active", "failed"]);
const MAX_LINKS = 10;
// hostedLinks.js make's refusal while a move can't be checked yet: asked again once that refresh is building.
const NOT_READ_WORDS = "The release it is moving to isn't read yet (its refresh is queued or starting): try again once that refresh is building; "
  + "its build reads the release first.";
const CONSUMER_WORDS = "A consumer of this project: { \"service\": \"svc_…\" }, { \"vps\": \"vps_…\", \"app\": \"…\" } or { \"hostedService\": \"hs_…\" }.";

/**
 * @param {any} world the stand-in's world
 * @param {object} parts
 * @param {ReturnType<typeof import("./services.js").createStandInServices>} parts.services its App Services, a link's consumers
 * @param {{ monthlyOf: (shape: { size: string, dataDiskGib: number }) => bigint | null, currency: string }} parts.prices the prices in force
 */
function createStandInHosted(world, { services, prices }) {
  const { faults, failure, answer, once, nextId, at, notFound } = world;
  /** @type {Map<string, any>} each hosted service, deleted ones too */
  const hosted = new Map();
  /** @type {Map<string, any>} each link, by id, in the order made */
  const links = new Map();

  const invalid = (fieldErrors) => failure(422, "validation_failed", `Check ${Object.keys(fieldErrors).join(", ")}.`, { fieldErrors });
  const invalidState = (state) => failure(409, "invalid_state", `This can't be done while it is ${state}.`, { state });
  const hostOf = (one) => `${one.name}.${projectLabel(one.projectId)}.internal`;
  const linksOf = (hostedServiceId) => [...links.values()].filter((link) => link.hostedServiceId === hostedServiceId);
  const event = (one, type, details) => world.emitIn(one.projectId, type, { kind: "hosted", id: one.id }, details);
  /** What a machine of a size and data disk takes of its project's quotas. */
  const taking = (size, dataDiskGib) => ({ vcpus: MACHINE_SIZES[size].vcpus, memoryGib: MACHINE_SIZES[size].memoryGib, diskGib: dataDiskGib });

  /** The hosted service's connection (hostedValues.js connectionOf): mobilynet's fields, then its provider's. @param {any} one */
  function connectionOf(one) {
    const { provides } = catalogueApp(one.app);
    const host = hostOf(one);
    const connection = {};
    for (const field of interfaceNamed(one.interface).fields) {
      if (field.from === "mobilynet") {
        connection[field.name] = { host, port: provides.port, url: `http://${host}:${provides.port}` }[field.value];
      } else if (field.from === "provider") {
        const source = provides.connection[field.name];
        connection[field.name] = source && "setting" in source ? one.settings[source.setting] ?? null : source?.literal ?? null;
      }
    }
    return connection;
  }

  /** Its links by state, as its view counts them. @param {string} hostedServiceId */
  function countsOf(hostedServiceId) {
    const counts = { active: 0, pending: 0, failed: 0 };
    for (const link of linksOf(hostedServiceId)) {
      if (link.state === "active") counts.active += 1;
      else if (link.state === "failed") counts.failed += 1;
      else if (link.state !== "revoked") counts.pending += 1;
    }
    return counts;
  }

  /** A hosted service as mobilynet's API shows it (hostedServices.js viewOf). @param {any} one */
  function view(one) {
    const { title, provides } = catalogueApp(one.app);
    const counts = countsOf(one.id);
    const machineStep = one.state === "creating" ? "running" : one.state === "failed" ? "failed" : "done";
    const ready = machineStep === "done";
    return {
      id: one.id,
      projectId: one.projectId,
      name: one.name,
      app: one.app,
      title,
      interface: one.interface,
      version: provides.version,
      region: one.region,
      size: one.size,
      machine: { size: one.machineSize, ...MACHINE_SIZES[one.machineSize], dataDiskGib: one.dataDiskGib },
      state: one.state,
      health: structuredClone(one.health),
      connection: connectionOf(one),
      backups: { enabled: true, latestPoint: null, lastFailure: null },
      links: { active: counts.active, pending: counts.pending },
      progress: [
        { step: "machine", state: machineStep },
        { step: "app", state: machineStep },
        { step: "links", state: counts.failed > 0 ? "failed" : counts.pending > 0 ? (ready ? "running" : "waiting") : "done" },
        { step: "health", state: one.health.state === "unknown" ? (ready ? "running" : "waiting") : "done" }
      ],
      labels: { ...one.labels },
      restoredFrom: null,
      lastError: null,
      createdAt: one.createdAt,
      changedAt: one.changedAt,
      ...(one.deletedAt ? { deletedAt: one.deletedAt } : {})
    };
  }

  /** A link as mobilynet's API shows it (hostedLinks.js linkView): its connection with its credential's plain fields. @param {any} link */
  function linkView(link) {
    return {
      id: link.id,
      hostedServiceId: link.hostedServiceId,
      state: link.state,
      consumer: { kind: link.consumerKind, id: link.consumerId, name: link.consumerName },
      need: link.need,
      interface: link.interface,
      settings: needSettings({ as: link.need, interface: link.interface }).map((entry) => entry.name),
      connection: { ...connectionOf(hosted.get(link.hostedServiceId)), ...link.credential },
      error: link.error,
      createdAt: link.createdAt,
      activeAt: link.activeAt,
      revokedAt: link.revokedAt
    };
  }

  /** A hosted service's operation as its answers show it. */
  function operation(one, kind) {
    const made = { id: nextId("op"), kind, state: "running", hostedServiceId: one.id, error: null, createdAt: at(), finishedAt: null };
    one.operations.push(made);
    return { ...made };
  }

  /** The catalogue (`GET /v1/hosted-services/catalogue`, any key): each app, its interface, sizes with their prices. */
  function catalogue() {
    return {
      currency: prices.currency,
      items: CATALOGUE.map(({ app, title, summary, settings, provides }) => {
        const found = interfaceNamed(provides.interface);
        return {
          app,
          title,
          summary,
          interface: {
            id: found.id,
            title: found.title,
            like: found.like,
            icon: found.icon,
            fields: found.fields.map(({ name, title: fieldTitle, type, secret, from }) => ({ name, title: fieldTitle, type, secret, from }))
          },
          version: provides.version,
          port: provides.port,
          sizes: Object.entries(provides.sizes).map(([name, { size, dataDisk }]) => {
            const monthly = prices.monthlyOf({ size, dataDiskGib: dataDisk });
            return { name, size, ...MACHINE_SIZES[size], dataDiskGib: dataDisk, monthlyNano: monthly === null ? null : monthly.toString() };
          }),
          defaultSize: provides.defaultSize,
          settings: Object.entries(provides.settings).filter(([, source]) => "ask" in source).map(([name, source]) => {
            const fills = Object.entries(provides.connection).find(([, value]) => value.setting === name)?.[0];
            const fieldTitle = found.fields.find((field) => field.name === fills)?.title ?? settings[name].description ?? name;
            return { name, title: fieldTitle, type: settings[name].type, required: source.ask === "required", ...(source.ask === "optional" ? { default: source.default } : {}) };
          }),
          metrics: Object.entries(provides.metrics).map(([name, entry]) => ({ name, ...entry }))
        };
      })
    };
  }

  /**
   * The hosted app's own settings from what a create gives (hostedValues.js providedSettings): literals, generated
   * secrets, mobilynet's region, and each asked one as given or its default.
   */
  function providedSettings(entry, given, region) {
    const settings = {};
    const secrets = {};
    const errors = {};
    for (const name of Object.keys(given)) {
      if (!("ask" in (entry.provides.settings[name] ?? {}))) errors[`settings.${name}`] = "Not a setting this hosted service asks for.";
    }
    for (const [name, source] of Object.entries(entry.provides.settings)) {
      let value;
      if ("literal" in source) value = source.literal;
      else if ("generate" in source) value = randomText(source);
      else if ("mobilynet" in source) value = region;
      else if (Object.hasOwn(given, name)) value = given[name];
      else if (source.ask === "optional") value = source.default;
      else {
        errors[`settings.${name}`] = "Required: this hosted service asks for it.";
        continue;
      }
      if (entry.settings[name].secret) secrets[name] = String(value);
      else settings[name] = value;
    }
    return { settings, secrets, errors };
  }

  /** Whether a name is held in a mobilynet project: by an App Service or another hosted service. */
  function nameTaken(projectId, name) {
    return services.nameTaken(projectId, name) || [...hosted.values()].some((one) => one.projectId === projectId && one.name === name && !one.deletedAt);
  }

  /**
   * What a link would fill, checked as mobilynet's make checks it, before anything is kept: its consumer (an App
   * Service of the project, the caller holding `services:manage`), the need of its declaration, and no held link of
   * that need.
   * @param {any} one the hosted service @param {any} input `{ consumer, need? }` @param {any} caller @param {any[]} planned links planned with it
   * @returns {{ refusal: any } | { plan: any }}
   */
  function planLink(one, input, caller, planned = []) {
    const record = isRecord(input?.consumer) ? input.consumer : null;
    const keys = record ? Object.keys(record).sort().join(",") : "";
    const text = (key) => typeof record?.[key] === "string" && record[key].length > 0 && record[key].length <= 64;
    const known = (keys === "service" && text("service")) || (keys === "app,vps" && text("vps") && text("app")) || (keys === "hostedService" && text("hostedService"));
    if (!known) return { refusal: invalid({ consumer: CONSUMER_WORDS }) };
    if (keys !== "service") return { refusal: invalid({ consumer: "The stand-in links an App Service alone: { \"service\": \"svc_…\" }." }) };
    const lacking = world.scopeRefusal(caller, "services:manage");
    if (lacking) return { refusal: lacking };
    const reached = services.linkConsumer(record.service, one.projectId);
    if (reached.refusal) return reached;
    const { service, declaration, ahead, pending } = reached;
    // The release it runs, if it names the need; else the release its refresh ahead moves it to (M14); else refused,
    // for a moment while a move can't be checked yet.
    const running = declaration ? needOf(declaration, one, input) : null;
    const coming = !running?.need && ahead?.declaration ? needOf(ahead.declaration, one, input) : null;
    if (!running?.need && !coming?.need) {
      if (pending) return { refusal: invalid({ consumer: NOT_READ_WORDS }) };
      if (!running && !coming) return { refusal: invalid({ consumer: "Its app has no release built yet: link it once one has." }) };
      return { refusal: (running ?? coming).refusal };
    }
    const need = running?.need ?? coming.need;
    const held = [...links.values()].find((link) => link.consumerKind === "service" && link.consumerId === service.id
      && link.need === need.as && HELD.includes(link.state))
      ?? planned.find((plan) => plan.service.id === service.id && plan.need.as === need.as);
    if (held) {
      const linkId = held.id ?? "another link";
      return { refusal: failure(409, "need_linked", `Its need ${need.as} is already linked (${linkId}): remove that link first.`, { need: need.as, linkId }) };
    }
    const count = linksOf(one.id).filter((link) => HELD.includes(link.state)).length + planned.length;
    if (count >= MAX_LINKS) return { refusal: invalid({ consumer: `A hosted service has at most ${MAX_LINKS} links.` }) };
    return { plan: { service, need, ahead: running?.need ? null : ahead.refresh } };
  }

  /** The need of a declaration a link fills, or why none: the one named, else its one need of the interface. */
  function needOf(declaration, one, input) {
    const needs = declaration.needs.filter((entry) => entry.interface === one.interface);
    if (input.need !== undefined && input.need !== null) {
      const need = needs.find((entry) => entry.as === input.need);
      return need ? { need } : { refusal: invalid({ need: `Its app declares no need ${String(input.need)} of ${one.interface}.` }) };
    }
    if (needs.length === 1) return { need: needs[0] };
    if (needs.length === 0) return { refusal: invalid({ need: `Its app declares no need of ${one.interface} (the needs of its mobilynet.json).` }) };
    return { refusal: invalid({ need: `Its app declares several needs of ${one.interface}: name one of ${needs.map((entry) => entry.as).join(", ")}.` }) };
  }

  /** Keeps a planned link, `issuing`, and gives its consumer its need's settings. Answers it and its secret fields. */
  function makeLink(one, { service, need, ahead }) {
    const id = nextId("lnk");
    const credential = newCredential(one.interface, id);
    const link = {
      id,
      projectId: one.projectId,
      hostedServiceId: one.id,
      consumerKind: "service",
      consumerId: service.id,
      consumerName: service.name,
      need: need.as,
      interface: one.interface,
      state: "issuing",
      credential: credential.plain,
      secrets: credential.secret,
      error: null,
      createdAt: at(),
      changedAt: at(),
      activeAt: null,
      revokedAt: null
    };
    links.set(id, link);
    const values = needValues(need, connectionOf(one), credential);
    // Made against the refresh ahead, the link's settings go into that refresh; else, a settings refresh of a running
    // service is refused only when its declaration's required settings are missing, which a service that runs a
    // release never has: the link's settings are queued behind any refresh under way.
    if (ahead) services.linkSettingsAhead(service, ahead, { settings: values.settings, secrets: values.secrets });
    else services.linkSettings(service, { settings: values.settings, secrets: values.secrets });
    return { link, secrets: credential.secret };
  }

  /**
   * A link's ending (hostedLinks.js end): `revoking`, or `revoked` at once when its hosted service goes with it; its
   * need's settings taken out of its consumer unless the consumer itself is going.
   */
  function endLink(link, { gone = false, consumerGoing = false } = {}) {
    Object.assign(link, { state: gone ? "revoked" : "revoking", changedAt: at(), ...(gone ? { revokedAt: at() } : {}) });
    if (!consumerGoing) {
      const reached = services.linkConsumer(link.consumerId, link.projectId);
      const names = needSettings({ as: link.need, interface: link.interface }).map((entry) => entry.name);
      if (reached.service) services.linkSettings(reached.service, { remove: names });
    }
    if (gone) world.emitIn(link.projectId, "hosted.link_revoked", { kind: "link", id: link.id }, {});
  }

  /** `POST /v1/projects/{p}/hosted-services` (createHostedService). */
  function create(projectId, body, idempotencyKey, caller) {
    const input = isRecord(body) ? body : {};
    if (input.fromBackup != null) return invalid({ fromBackup: "The stand-in restores no backups: create a hosted service from its app." });
    if (input.name != null && (typeof input.name !== "string" || !MACHINE_NAME.test(input.name))) {
      return invalid({ name: "Use 1 to 64 lowercase letters, digits and hyphens, starting and ending with a letter or digit." });
    }
    const entry = typeof input.app === "string" ? catalogueApp(input.app) : null;
    if (!entry) return invalid({ app: `A catalogue app that runs as a hosted service: ${CATALOGUE.map((one) => one.app).join(", ")} (GET /v1/hosted-services/catalogue).` });
    const sizeName = input.size ?? entry.provides.defaultSize;
    if (!Object.hasOwn(entry.provides.sizes, sizeName)) return invalid({ size: `One of ${Object.keys(entry.provides.sizes).join(", ")}.` });
    const region = input.region ?? REGIONS[0];
    if (!REGIONS.includes(region)) return invalid({ region: `Choose one of ${REGIONS.join(", ")}.` });
    if (input.settings != null && !isRecord(input.settings)) return invalid({ settings: "An object of setting names and values." });
    const labelled = labelsOf(input.labels ?? {});
    if (labelled.errors) return invalid(labelled.errors);
    if (input.links != null && (!Array.isArray(input.links) || input.links.length > MAX_LINKS)) {
      return invalid({ links: `A list of up to ${MAX_LINKS} links, each { consumer, need? }.` });
    }
    const { size, dataDisk } = entry.provides.sizes[sizeName];
    let shown = {};
    const made = once(idempotencyKey, `${projectId} hosted ${JSON.stringify(body)}`, () => {
      const refused = world.admit(projectId, { machines: 1, ...taking(size, dataDisk) });
      if (refused) return refused;
      if (faults.noCapacity || !HOST_REGIONS.includes(region)) return failure(503, "no_capacity", "No capacity in the region for that size now.");
      let name = input.name;
      if (name && nameTaken(projectId, name)) return failure(409, "name_taken", `The name "${name}" is already taken here.`, { name });
      while (!name || nameTaken(projectId, name)) name = `${entry.provides.interface}-${randomText({ alphabet: "base32", length: 4 })}`;
      const own = providedSettings(entry, input.settings ?? {}, region);
      if (Object.keys(own.errors).length > 0) return invalid(own.errors);
      const one = {
        id: nextId("hs"),
        projectId,
        name,
        app: entry.app,
        interface: entry.provides.interface,
        region,
        size: sizeName,
        machineSize: size,
        dataDiskGib: dataDisk,
        state: "creating",
        health: { state: "unknown", reasons: [], checkedAt: null, metrics: [] },
        settings: own.settings,
        secrets: own.secrets,
        labels: labelled.labels,
        operations: [],
        createdAt: at(),
        changedAt: at(),
        deletedAt: null
      };
      const plans = [];
      for (const asked of input.links ?? []) {
        const planned = planLink(one, asked ?? {}, caller, plans);
        if (planned.refusal) return planned.refusal;
        plans.push(planned.plan);
      }
      hosted.set(one.id, one);
      const linked = plans.map((plan) => makeLink(one, plan));
      const started = operation(one, "create");
      event(one, "hosted.created", { app: one.app, operationId: started.id });
      // A new link's secrets are shown this once and never kept with the key's answer for a replay.
      shown = Object.fromEntries(linked.map(({ link, secrets }) => [link.id, secrets]));
      return answer(202, { hostedService: view(one), links: linked.map(({ link }) => linkView(link)), operation: started });
    });
    if (made.status >= 300) return made;
    const shownLinks = made.body.links.map((link) => ({ ...link, connection: { ...link.connection, ...(shown[link.id] ?? {}) } }));
    return { ...made, body: { ...made.body, links: shownLinks } };
  }

  /** `POST /v1/hosted-services/{id}/links` (createHostedLink): `202 { link, connection }`, its secrets shown once. */
  function link(one, body, idempotencyKey, caller) {
    let secrets = {};
    const make = () => {
      const planned = planLink(one, isRecord(body) ? body : {}, caller);
      if (planned.refusal) return planned.refusal;
      const made = makeLink(one, planned.plan);
      secrets = made.secrets;
      const shownLink = linkView(made.link);
      return answer(202, { link: shownLink, connection: shownLink.connection });
    };
    const made = idempotencyKey ? once(idempotencyKey, `${one.id} link ${JSON.stringify(body)}`, make) : make();
    return made.status >= 300 ? made : { ...made, body: { ...made.body, connection: { ...made.body.connection, ...secrets } } };
  }

  /** `DELETE /v1/hosted-services/{id}/links/{linkId}` (deleteHostedLink): `202 { link }`, `revoking`. */
  function unlink(one, linkId) {
    const found = links.get(linkId);
    if (!found || found.hostedServiceId !== one.id) return notFound("link");
    if (HELD.includes(found.state)) endLink(found);
    return answer(202, { link: linkView(found) });
  }

  /** `DELETE /v1/hosted-services/{id}` (deleteHostedService), `?links=revoke` ending its links with it. */
  function remove(one, revoke) {
    if (revoke !== null && revoke !== "revoke") return invalid({ links: "revoke, to remove its links with it." });
    const open = linksOf(one.id).filter((entry) => HELD.includes(entry.state));
    if (open.length > 0 && revoke !== "revoke") {
      return failure(409, "hosted_service_linked", `The hosted service has ${open.length} link${open.length === 1 ? "" : "s"}: remove them first, or delete it with links=revoke.`, { hostedServiceId: one.id, links: open.length });
    }
    if (!["running", "stopped", "failed"].includes(one.state)) return invalidState(one.state);
    for (const entry of open) endLink(entry, { gone: true });
    Object.assign(one, { state: "deleted", deletedAt: at(), changedAt: at() });
    const started = operation(one, "delete");
    event(one, "hosted.deleted", { operationId: started.id });
    return answer(202, { hostedService: view(one), operation: started });
  }

  /**
   * `PATCH /v1/hosted-services/{id}` (changeHostedService): another of its app's sizes, its disk only growing, and its
   * labels replaced whole; a larger machine or disk admitted by the project's spending cap and quotas.
   */
  function change(one, body) {
    const input = isRecord(body) ? body : {};
    const { provides } = catalogueApp(one.app);
    if (input.size === undefined && input.labels === undefined) return invalid({ size: `One of ${Object.keys(provides.sizes).join(", ")}, or labels.` });
    if (input.size !== undefined && (typeof input.size !== "string" || !Object.hasOwn(provides.sizes, input.size))) {
      return invalid({ size: `One of ${Object.keys(provides.sizes).join(", ")}.` });
    }
    const labelled = input.labels === undefined ? null : labelsOf(input.labels);
    if (labelled?.errors) return invalid(labelled.errors);
    let started = null;
    if (input.size !== undefined) {
      const wanted = provides.sizes[input.size];
      const disk = Math.max(one.dataDiskGib, wanted.dataDisk);
      if (wanted.size !== one.machineSize || disk !== one.dataDiskGib) {
        if (!["running", "stopped"].includes(one.state)) return invalidState(one.state);
        const before = taking(one.machineSize, one.dataDiskGib);
        const after = taking(wanted.size, disk);
        const adding = { vcpus: after.vcpus - before.vcpus, memoryGib: after.memoryGib - before.memoryGib, diskGib: after.diskGib - before.diskGib };
        if (Object.values(adding).some((amount) => amount > 0)) {
          const refused = world.admit(one.projectId, adding);
          if (refused) return refused;
        }
        Object.assign(one, { machineSize: wanted.size, dataDiskGib: disk, state: "resizing" });
        started = operation(one, "resize");
      }
      one.size = input.size;
    }
    if (labelled) one.labels = labelled.labels;
    one.changedAt = at();
    if (labelled) event(one, "hosted.changed", { fields: ["labels"] });
    return answer(started ? 202 : 200, { hostedService: view(one), operation: started });
  }

  /** Moves every hosted service and link one step on. */
  function advance() {
    for (const one of hosted.values()) {
      if (one.deletedAt) {
        for (const running of one.operations.filter((entry) => entry.state === "running")) Object.assign(running, { state: "succeeded", finishedAt: at() });
        continue;
      }
      if ((one.state === "creating" && !faults.neverBoots) || one.state === "resizing") {
        Object.assign(one, { state: "running", changedAt: at(), health: { state: "healthy", reasons: [], checkedAt: at(), metrics: [] } });
        for (const running of one.operations.filter((entry) => entry.state === "running")) Object.assign(running, { state: "succeeded", finishedAt: at() });
      }
      if (one.state !== "running") continue;
      for (const entry of linksOf(one.id)) {
        if (entry.state === "issuing") Object.assign(entry, { state: "active", activeAt: at(), changedAt: at() });
        else if (entry.state === "revoking") Object.assign(entry, { state: "revoked", revokedAt: at(), changedAt: at() });
      }
    }
  }

  /**
   * A refresh of an App Service failed (M14, hostedLinks.js refreshAbandoned): each held link whose need the release it
   * still runs doesn't name (every one, when its first release failed) ends as a deleted consumer's does, its settings
   * taken out of each change of settings still queued, so one queued behind runs on the release the service runs.
   * STAND-IN ONLY: no refresh is aborted, so none other is under way as one ends, and no link is kept for the settings
   * a refresh ahead carries, as mobilynet keeps it.
   * @param {any} service
   */
  function refreshFailed(service) {
    const running = services.linkConsumer(service.id, service.projectId).declaration;
    const ended = [];
    for (const entry of links.values()) {
      if (entry.consumerKind !== "service" || entry.consumerId !== service.id || !HELD.includes(entry.state)) continue;
      if (running?.needs.some((need) => need.as === entry.need && need.interface === entry.interface)) continue;
      endLink(entry, { gone: Boolean(hosted.get(entry.hostedServiceId)?.deletedAt), consumerGoing: true });
      ended.push(...needSettings({ as: entry.need, interface: entry.interface }).map((setting) => setting.name));
    }
    if (ended.length > 0) services.dropLinkSettings(service, ended);
  }

  /** A deleted App Service's links end with it, their settings not taken out (hostedLinks.js consumerGone). */
  function consumerGone(kind, consumerId) {
    for (const entry of links.values()) {
      if (entry.consumerKind === kind && entry.consumerId === consumerId && HELD.includes(entry.state)) {
        endLink(entry, { gone: Boolean(hosted.get(entry.hostedServiceId)?.deletedAt), consumerGoing: true });
      }
    }
  }

  /** What a project's live hosted services take of its quotas: a machine each, its vCPUs, memory and data disk. @param {string} projectId */
  function usage(projectId) {
    const used = { machines: 0, vcpus: 0, memoryGib: 0, diskGib: 0 };
    for (const one of hosted.values()) {
      if (one.projectId !== projectId || one.deletedAt) continue;
      const took = taking(one.machineSize, one.dataDiskGib);
      used.machines += 1;
      used.vcpus += took.vcpus;
      used.memoryGib += took.memoryGib;
      used.diskGib += took.diskGib;
    }
    return used;
  }

  /**
   * Answers a request about hosted services, or null when it is none of them.
   * @param {{ method: string, path: string, params: URLSearchParams, body: any, idempotencyKey?: string, caller: any }} request
   */
  function request({ method, path, params, body, idempotencyKey, caller }) {
    if (path === "/v1/hosted-services/catalogue") return method === "GET" ? answer(200, catalogue()) : null;
    const inProject = /^\/v1\/projects\/([^/]+)\/hosted-services$/u.exec(path);
    if (inProject) {
      const projectId = decodeURIComponent(inProject[1]);
      if (!world.reaches(caller, projectId)) return notFound("project");
      if (method === "POST") return create(projectId, body, idempotencyKey, caller);
      if (method === "GET") {
        const listed = [...hosted.values()].filter((one) => one.projectId === projectId && !one.deletedAt
          && (!params.get("app") || one.app === params.get("app")) && (!params.get("state") || one.state === params.get("state"))
          && labelsMatch(one.labels, params)).reverse().map(view);
        return answer(200, pageOf(listed, params));
      }
      return null;
    }
    const hostedPath = /^\/v1\/hosted-services\/([^/]+)(\/links(?:\/([^/]+))?)?$/u.exec(path);
    if (!hostedPath) return null;
    const one = hosted.get(decodeURIComponent(hostedPath[1]));
    if (!one || one.deletedAt || !world.reaches(caller, one.projectId)) return notFound("hosted service");
    if (!hostedPath[2]) {
      if (method === "GET") return answer(200, { hostedService: view(one) });
      if (method === "PATCH") return idempotencyKey ? once(idempotencyKey, `${one.id} change ${JSON.stringify(body)}`, () => change(one, body)) : change(one, body);
      if (method === "DELETE") return remove(one, params.get("links"));
      return null;
    }
    if (hostedPath[3] !== undefined) return method === "DELETE" ? unlink(one, decodeURIComponent(hostedPath[3])) : null;
    if (method === "GET") return answer(200, pageOf(linksOf(one.id).filter((entry) => entry.state !== "revoked").map(linkView), params));
    if (method === "POST") return link(one, body, idempotencyKey, caller);
    return null;
  }

  /** A hosted service with its own settings' and secrets' values and its links' (secrets too), for tests. @param {any} one */
  const heldView = (one) => ({
    ...view(one),
    settings: { ...one.settings },
    secrets: { ...one.secrets },
    operations: structuredClone(one.operations),
    links: linksOf(one.id).map((entry) => ({ ...linkView(entry), secrets: { ...entry.secrets } }))
  });

  const controls = Object.freeze({
    /** Every hosted service, deleted ones too, each with its links. */
    all: () => [...hosted.values()].map(heldView),
    /** One hosted service with its links, or null. @param {string} id */
    service: (id) => (hosted.has(id) ? heldView(hosted.get(id)) : null),
    /** The catalogue as `GET /v1/hosted-services/catalogue` answers it. */
    catalogue
  });

  return Object.freeze({
    request,
    advance,
    consumerGone,
    refreshFailed,
    nameTaken,
    usage,
    controls
  });
}

export { createStandInHosted };
