<template>
  <section class="system-world">
    <header class="system-world__toolbar">
      <div class="system-world__identity">
        <span class="system-world__mark" aria-hidden="true">
          <v-icon :icon="mdiCityVariantOutline" size="19" />
        </span>
        <div>
          <strong>File City · {{ rendererRevision }}</strong>
          <span>{{ statusLabel }}</span>
        </div>
      </div>

      <div class="system-world__mode-switch" aria-label="Choose File City view">
        <span>View</span>
        <v-btn
          :active="viewMode === 'folders'"
          :prepend-icon="mdiFolderOutline"
          size="x-small"
          title="Explore the physical file and directory city"
          type="button"
          variant="text"
          @click="setViewMode('folders')"
        >
          Folders
        </v-btn>
        <v-btn
          :active="viewMode === 'subsystems'"
          :prepend-icon="mdiLayersTripleOutline"
          size="x-small"
          title="Visit the semantic subsystem layer above the files"
          type="button"
          variant="text"
          @click="setViewMode('subsystems')"
        >
          Subsystems
        </v-btn>
        <v-btn
          :active="viewMode === 'runtime'"
          :prepend-icon="mdiCodeBraces"
          size="x-small"
          title="Color the physical city by client, server, and shared runtime"
          type="button"
          variant="text"
          @click="setViewMode('runtime')"
        >
          Runtime
        </v-btn>
      </div>

      <div class="system-world__view-actions">
        <v-btn
          :icon="mdiCrosshairsGps"
          size="x-small"
          title="Fit the current layer"
          type="button"
          variant="text"
          @click="fitWorld"
        />
        <v-btn
          :icon="mdiMapOutline"
          size="x-small"
          title="Top-down map"
          type="button"
          variant="text"
          @click="setWorldView('top')"
        />
        <v-btn
          :icon="mdiRotate3dVariant"
          size="x-small"
          title="Perspective view"
          type="button"
          variant="text"
          @click="setWorldView('perspective')"
        />
        <v-btn
          color="primary"
          :disabled="updating || systemStatus.status === 'unsupported'"
          :loading="updating"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          variant="tonal"
          @click="updateSystem"
        >
          Refresh map
        </v-btn>
      </div>
    </header>

    <div class="system-world__stage">
      <canvas
        ref="canvasElement"
        aria-label="Interactive 3D file city and subsystem sky. Left-drag or use arrow keys to move; begin a two-finger gesture vertically, use W and S, plus and minus, or Control-Up and Control-Down to move forward and back; begin a two-finger gesture horizontally to orbit freely until that gesture ends; click a building, directory, campus, or subsystem to inspect it; double-click a subsystem cloud to arrange its physical city stratum."
        class="system-world__canvas"
        tabindex="0"
      />

      <div
        v-if="hoveredSubsystemConnection"
        class="system-world__connection-tooltip"
        :style="{
          left: `${hoveredSubsystemConnection.canvasX}px`,
          top: `${hoveredSubsystemConnection.canvasY}px`
        }"
      >
        <span>{{ hoveredSubsystemConnection.kind === 'injection' ? 'Injected token' : 'Export' }}</span>
        <strong>{{ hoveredSubsystemConnection.reference }}</strong>
        <code v-for="file in hoveredSubsystemConnectionProviderFiles" :key="file.id">{{ file.path }}</code>
        <small>
          {{ hoveredSubsystemConnection.consumerSubsystemTitle }} ·
          {{ formatCount(hoveredSubsystemConnection.usageCount, 'consuming file') }}
        </small>
      </div>

      <div
        v-if="viewMode === 'subsystems'"
        class="system-world__layer-controls"
        aria-label="Optional subsystem context"
      >
        <span>Show</span>
        <button
          :aria-pressed="showSubsystemConnections"
          :class="{ 'system-world__layer-control--active': showSubsystemConnections }"
          title="Show bundled subsystem connections collected at owned directories or scattered files"
          type="button"
          @click="toggleSubsystemLayer('connections')"
        >
          Connections
        </button>
        <button
          :aria-pressed="showSubsystemFileEvidence"
          :class="{ 'system-world__layer-control--active': showSubsystemFileEvidence }"
          :disabled="!showSubsystemConnections"
          title="Opt in to the complete raw file-to-file web for the selected subsystem"
          type="button"
          @click="toggleSubsystemLayer('file-evidence')"
        >
          Raw file web
        </button>
        <button
          :aria-pressed="showSubsystemLibraries"
          :class="{ 'system-world__layer-control--active': showSubsystemLibraries }"
          title="Show imported npm packages and their importing files"
          type="button"
          @click="toggleSubsystemLayer('libraries')"
        >
          Libraries
        </button>
      </div>

      <div v-if="loading && !overview" class="system-world__state-card" role="status">
        <span class="system-world__state-orbit" aria-hidden="true" />
        <strong>Building the current file city…</strong>
        <span>Reading the checked-in map for this session.</span>
      </div>

      <div v-else-if="systemStatus.status === 'unsupported'" class="system-world__state-card">
        <v-icon :icon="mdiInformationOutline" size="32" />
        <strong>This project type does not have a metadata adapter yet.</strong>
        <span>Vibe64 currently enriches file cities for JSKIT projects only. No architectural meaning is being guessed.</span>
      </div>

      <div v-else-if="systemStatus.status === 'missing'" class="system-world__state-card">
        <v-icon :icon="mdiCityVariantOutline" size="36" />
        <strong>No current file map yet.</strong>
        <span>Generate one compact <code>vibe64.system.json</code> for this active session.</span>
        <v-btn
          color="primary"
          :loading="updating"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          @click="updateSystem"
        >
          Build file city
        </v-btn>
      </div>

      <div v-else-if="worldError || error" class="system-world__state-card system-world__state-card--error">
        <v-icon :icon="mdiAlertOutline" size="32" />
        <strong>File City could not render.</strong>
        <span>{{ worldError || error }}</span>
        <v-btn size="small" type="button" variant="tonal" @click="reload">Retry</v-btn>
      </div>

      <div v-if="systemStatus.status === 'stale'" class="system-world__stale" role="status">
        <span />
        Source changed — refresh to rebuild this current-session map.
      </div>

      <div v-if="latestUpdateLabel" class="system-world__progress" role="status">
        <span class="system-world__progress-pulse" />
        {{ latestUpdateLabel }}
      </div>

      <div v-if="overview" class="system-world__view-gizmo" aria-label="Rotate file city view">
        <button aria-label="Rotate view left" title="Rotate left" type="button" @click="rotateWorld(-20)">
          <v-icon :icon="mdiRotateLeft" size="15" />
        </button>
        <button
          class="system-world__view-gizmo-puck"
          aria-label="Drag to rotate the view"
          title="Drag to orbit the cities"
          type="button"
          @lostpointercapture="endViewRotation"
          @pointercancel="endViewRotation"
          @pointerdown="startViewRotation"
          @pointermove="continueViewRotation"
          @pointerup="endViewRotation"
        >
          <v-icon :icon="mdiOrbit" size="17" />
          <span>N</span>
        </button>
        <button aria-label="Rotate view right" title="Rotate right" type="button" @click="rotateWorld(20)">
          <v-icon :icon="mdiRotateRight" size="15" />
        </button>
      </div>

      <nav
        v-if="viewMode === 'subsystems' && subsystems.length"
        class="system-world__navigator"
        aria-label="File City subsystems"
      >
        <header>
          <span>Subsystems</span>
          <strong>{{ subsystems.length }}</strong>
        </header>
        <button
          v-for="subsystem in subsystems"
          :key="subsystem.id"
          :class="{ 'system-world__navigator-button--active': selectedSubsystem?.id === subsystem.id }"
          type="button"
          @click="inspectSubsystem(subsystem, { focus: true })"
        >
          <v-icon :icon="mdiLayersTripleOutline" size="13" />
          <span>
            <strong>{{ subsystem.title }}</strong>
            <small>{{ formatCount(subsystem.fileCount, 'file') }} · {{ dependencySummary(subsystem.dependencies) }}</small>
          </span>
        </button>
      </nav>

      <nav v-else-if="campuses.length" class="system-world__navigator" aria-label="File city campuses">
        <header>
          <span>Campuses</span>
          <strong>{{ campuses.length }}</strong>
        </header>
        <button
          v-for="campus in campuses"
          :key="campus.id"
          :class="{ 'system-world__navigator-button--active': selectedDirectory?.id === campus.id }"
          type="button"
          @click="selectCampus(campus)"
        >
          <v-icon :icon="mdiFolderOutline" size="13" />
          <span><strong>{{ campus.name }}</strong><small>{{ formatCount(campus.fileCount, 'file') }} · {{ formatLines(campus.lines) }} LOC</small></span>
        </button>
      </nav>

      <aside v-if="selectedSubsystem || selectedDirectory || selectedFile" class="system-world__inspector" aria-live="polite">
        <template v-if="selectedSubsystem">
          <div class="system-world__eyebrow">SUBSYSTEM · {{ selectedSubsystem.origin }}</div>
          <h2>{{ selectedSubsystem.title }}</h2>
          <p>{{ selectedSubsystem.description || 'This subsystem has structural ownership, but its purpose still needs a human-readable explanation.' }}</p>
          <div class="system-world__chips">
            <span>{{ selectedSubsystem.executionSide }}</span>
            <span>{{ selectedSubsystem.status }}</span>
            <span>{{ selectedSubsystem.authoredBy }}</span>
          </div>
          <div class="system-world__metrics">
            <span><strong>{{ selectedSubsystem.fileCount.toLocaleString() }}</strong> files</span>
            <span><strong>{{ formatLines(selectedSubsystem.lines) }}</strong> lines</span>
            <span><strong>{{ selectedSubsystem.anchors.length }}</strong> anchors</span>
            <span><strong>{{ selectedSubsystem.capabilities.length }}</strong> capabilities</span>
            <span><strong>{{ selectedSubsystemDependencies.outgoing.length }}</strong> outgoing</span>
            <span><strong>{{ selectedSubsystemDependencies.incoming.length }}</strong> incoming</span>
            <span><strong>{{ selectedSubsystemDependencies.external.length }}</strong> external</span>
          </div>
          <section
            v-if="editingSubsystemDepthId === selectedSubsystem.id"
            class="system-world__stratum-editor"
          >
            <div>
              <div class="system-world__eyebrow">PHYSICAL STRATUM</div>
              <strong>{{ selectedSubsystem.depth ? `Layer -${selectedSubsystem.depth}` : 'Generated baseline' }}</strong>
              <p>Shift every owned slab and scattered building together to express this subsystem's architectural layer.</p>
            </div>
            <div class="system-world__stratum-controls" aria-label="Subsystem physical stratum controls">
              <v-btn
                :disabled="savingSubsystemDepth || selectedSubsystem.depth <= 0"
                size="x-small"
                type="button"
                variant="tonal"
                @click="shiftSelectedSubsystemDepth(-1)"
              >
                Restore one level
              </v-btn>
              <div class="system-world__stratum-scale" aria-hidden="true">
                <span
                  v-for="depth in subsystemDepthLevels"
                  :key="depth"
                  :class="{ 'system-world__stratum-level--active': selectedSubsystem.depth === depth }"
                >{{ depth ? `−${depth}` : '0' }}</span>
              </div>
              <v-btn
                :disabled="savingSubsystemDepth || selectedSubsystem.depth >= SUBSYSTEM_DEPTH_MAX"
                :loading="savingSubsystemDepth"
                size="x-small"
                type="button"
                variant="tonal"
                @click="shiftSelectedSubsystemDepth(1)"
              >
                Lower one level
              </v-btn>
              <v-btn
                :disabled="savingSubsystemDepth"
                size="x-small"
                type="button"
                variant="text"
                @click="editingSubsystemDepthId = ''"
              >
                Done
              </v-btn>
            </div>
          </section>
          <p v-else class="system-world__stratum-hint">
            Double-click this subsystem's cloud to arrange the slabs and buildings it owns.
          </p>
          <section v-if="selectedSubsystemConnection" class="system-world__connection-focus">
            <div class="system-world__eyebrow">{{ selectedSubsystemConnection.kind }} collection point</div>
            <h3>
              {{ selectedSubsystemConnection.consumerSubsystemTitle }} uses
              <code>{{ selectedSubsystemConnection.reference }}</code>
            </h3>
            <p>
              Provided by {{ selectedSubsystemConnection.providerSubsystemTitle }}. This bundled line replaces
              {{ formatCount(selectedSubsystemConnection.usageCount, 'exact file connection') }} at this physical piece.
            </p>
            <p v-if="selectedSubsystemConnection.collectionKind === 'directory'" class="system-world__path">
              Collected at folder: {{ selectedSubsystemConnection.collectionPath }}
            </p>
            <p v-else-if="selectedSubsystemConnection.collectionKind === 'file'" class="system-world__path">
              Scattered piece: {{ selectedSubsystemConnection.collectionPath }}
            </p>
            <p v-else>
              No exact owned directory or file could be proven for this connection.
            </p>
            <div v-if="selectedSubsystemConnectionProviderFiles.length" class="system-world__connection-providers">
              <strong>Provided by</strong>
              <code v-for="file in selectedSubsystemConnectionProviderFiles" :key="file.id">{{ file.path }}</code>
            </div>
            <details class="system-world__connection-last-mile" open>
              <summary>Last mile · {{ formatCount(selectedSubsystemConnectionFiles.length, 'file') }}</summary>
              <button
                v-for="file in selectedSubsystemConnectionFiles"
                :key="file.id"
                :class="{ 'system-world__connection-file--active': activeFileId === file.id }"
                type="button"
                @click="inspectSubsystemConnectionFile(file)"
              >
                <strong>{{ pathFileName(file.path) }}</strong>
                <span>{{ file.path }}</span>
              </button>
            </details>
            <div v-if="selectedSubsystemConnectionFile" class="system-world__connection-file-detail">
              <div class="system-world__eyebrow">LAST-MILE FILE</div>
              <h4>{{ pathFileName(selectedSubsystemConnectionFile.path) }}</h4>
              <code>{{ selectedSubsystemConnectionFile.path }}</code>
              <p>{{ selectedFilePurpose }}</p>
              <span>{{ formatLines(selectedSubsystemConnectionFile.lines) }} lines</span>
              <v-btn
                v-if="selectedFile"
                :prepend-icon="mdiFileCodeOutline"
                size="x-small"
                type="button"
                variant="tonal"
                @click="openSelectedFile"
              >
                Open in Files
              </v-btn>
            </div>
          </section>
          <div
            v-for="section in selectedSubsystemRelationshipSections"
            :key="section.direction"
            class="system-world__section"
          >
            <strong>{{ section.title }}</strong>
            <div class="system-world__relationships">
              <div
                v-for="dependency in section.dependencies"
                :key="dependency.subsystemId"
                class="system-world__relationship"
              >
                <button
                  title="Focus the exact file endpoints proven for this relationship"
                  type="button"
                  @click="focusSubsystemDependency(dependency, section.direction)"
                >
                  <span>{{ section.direction === 'outgoing' ? 'connects →' : '← connects' }}</span>
                  <strong>{{ dependency.title }} · {{ dependencyEvidenceLabel(dependency) }}</strong>
                </button>
                <div
                  v-if="dependency.symbols.length || dependency.injectionTokens.length"
                  class="system-world__boundary-summary"
                >
                  <strong>What crosses this boundary</strong>
                  <p v-if="dependency.symbols.length">
                    <span>{{ section.direction === 'outgoing' ? 'Methods / exports used' : 'Methods / exports used here' }}</span>
                    {{ dependency.symbols.join(', ') }}
                  </p>
                  <p v-if="dependency.injectionTokens.length">
                    <span>Injected tokens</span>
                    {{ dependency.injectionTokens.join(', ') }}
                  </p>
                </div>
                <div v-if="dependency.fileConnections.length" class="system-world__connection-files">
                  <details
                    v-for="connection in dependency.fileConnections"
                    :key="`${connection.fromFileId}:${connection.toFileId}`"
                  >
                    <summary>
                      <strong>{{ pathFileName(connection.toPath) }}</strong>
                      <span>from {{ pathFileName(connection.fromPath) }}</span>
                    </summary>
                    <div class="system-world__connection-detail">
                      <code>{{ connection.fromPath }}</code>
                      <span aria-hidden="true">→</span>
                      <code>{{ connection.toPath }}</code>
                      <p v-if="connection.symbols.length">
                        Exports used:
                        <strong>{{ connection.symbols.join(', ') }}</strong>
                      </p>
                      <p v-else-if="connection.kinds.includes('import')">No named export is statically selected by this import.</p>
                      <p v-if="connection.kinds.includes('injection')">
                        Injected token:
                        <strong>{{ connection.injectionTokens.join(', ') }}</strong>
                      </p>
                    </div>
                  </details>
                </div>
                <p v-else-if="dependency.declared" class="system-world__declared-only">
                  Declared by framework metadata; no exact file pair is claimed.
                </p>
              </div>
            </div>
          </div>
          <div v-if="selectedSubsystemDependencies.external.length" class="system-world__section">
            <strong>External packages</strong>
            <ul>
              <li v-for="dependency in selectedSubsystemDependencies.external" :key="`${dependency.kind}:${dependency.packageId}`">
                <strong>{{ dependency.title }}</strong>
                <span>npm package · {{ dependencyEvidenceLabel(dependency) }}</span>
              </li>
            </ul>
          </div>
          <div v-if="selectedSubsystem.anchors.length" class="system-world__section">
            <strong>Code below this cloud</strong>
            <ul>
              <li v-for="anchor in selectedSubsystem.anchors" :key="`${anchor.kind}:${anchor.path}:${anchor.relation}`">
                <strong>{{ anchor.relation }} · {{ anchor.path }}</strong>
                <span>{{ anchor.kind }} · {{ anchor.origin }}</span>
              </li>
            </ul>
          </div>
          <div v-if="selectedSubsystem.capabilities.length" class="system-world__section">
            <strong>What it provides or needs</strong>
            <ul>
              <li v-for="capability in selectedSubsystem.capabilities" :key="capability.id">
                <strong>{{ capability.title }}</strong>
                <span>{{ capability.direction }} {{ capability.kind }}<template v-if="capability.value && capability.value !== capability.title"> · {{ capability.value }}</template></span>
              </li>
            </ul>
          </div>
          <p v-if="selectedSubsystem.unmatchedAnchorCount" class="system-world__large-file-warning">
            {{ selectedSubsystem.unmatchedAnchorCount }} declared anchor{{ selectedSubsystem.unmatchedAnchorCount === 1 ? '' : 's' }} no longer match the current tree.
          </p>
          <div class="system-world__inspector-actions">
            <v-btn
              size="small"
              type="button"
              variant="tonal"
              @click="editingSubsystemDepthId = selectedSubsystem.id"
            >
              Arrange physical layer
            </v-btn>
            <v-btn
              :disabled="!askChatAvailable"
              :prepend-icon="mdiMessageOutline"
              size="small"
              type="button"
              variant="tonal"
              @click="askAboutSelection"
            >
              Ask about this subsystem
            </v-btn>
            <v-btn
              :disabled="!askChatAvailable"
              :prepend-icon="mdiLayersTripleOutline"
              size="small"
              type="button"
              variant="text"
              @click="discoverSubsystems"
            >
              Discover more
            </v-btn>
          </div>
        </template>

        <template v-else-if="selectedDirectory">
          <div class="system-world__eyebrow">{{ selectedDirectory.kind === 'campus' ? (selectedDirectory.implicit ? 'MAIN CAMPUS' : 'JSKIT CAMPUS') : 'DIRECTORY PRECINCT' }}</div>
          <h2>{{ selectedDirectory.name }}</h2>
          <p class="system-world__path">{{ selectedDirectory.path || (selectedDirectory.kind === 'campus' ? 'Unclaimed project tree' : 'Project root') }}</p>
          <div class="system-world__metrics">
            <span><strong>{{ selectedDirectory.fileCount.toLocaleString() }}</strong> files</span>
            <span><strong>{{ formatLines(selectedDirectory.lines) }}</strong> lines</span>
            <span><strong>{{ selectedDirectory.subsystems.length }}</strong> subsystems</span>
            <span v-if="selectedDirectory.kind !== 'campus'"><strong>{{ selectedDirectory.hierarchyDepth }}</strong> directory level</span>
          </div>
          <p v-if="selectedDirectory.kind === 'campus'">
            {{ selectedDirectory.implicit
              ? 'This is everything not claimed by an adapter-defined campus. Its raised terraces still represent the real directories.'
              : 'JSKIT gives this source tree its own land parcel. Its raised terraces are the real directories below that root.' }}
          </p>
          <p v-else>
            This is directory level {{ selectedDirectory.hierarchyDepth }}. Its raised terrace and labelled perimeter show nesting and ownership, and every building inside it is a real file.
          </p>
          <div v-if="selectedDirectory.subsystems.length" class="system-world__section">
            <strong>System ownership found here</strong>
            <div class="system-world__chips">
              <span v-for="subsystem in selectedDirectory.subsystems" :key="subsystem.id">{{ subsystem.title }}</span>
            </div>
          </div>
          <button
            v-if="selectedDirectory.largestFile"
            class="system-world__largest-file"
            type="button"
            @click="inspectFile(selectedDirectory.largestFile, { focus: true })"
          >
            <span>Largest building</span>
            <strong>{{ fileName(selectedDirectory.largestFile) }}</strong>
            <small>{{ formatLines(selectedDirectory.largestFile.lines) }} lines</small>
          </button>
          <div class="system-world__inspector-actions">
            <v-btn
              :disabled="!askChatAvailable"
              :prepend-icon="mdiMessageOutline"
              size="small"
              type="button"
              variant="tonal"
              @click="askAboutSelection"
            >
              Ask about this folder
            </v-btn>
          </div>
        </template>

        <template v-else>
          <div class="system-world__eyebrow">FILE BUILDING</div>
          <h2>{{ selectedFileName }}</h2>
          <p class="system-world__path">{{ selectedFile.path }}</p>
          <div class="system-world__chips">
            <span>{{ selectedFile.executionSide || 'unknown' }}</span>
            <span>{{ selectedFileSubsystem }}</span>
          </div>
          <div class="system-world__metrics">
            <span><strong>{{ selectedFile.lines.toLocaleString() }}</strong> lines</span>
            <span><strong>{{ selectedFile.imports.length }}</strong> imports</span>
            <span><strong>{{ selectedFileImportedBy }}</strong> imported by</span>
          </div>
          <div class="system-world__section">
            <strong>What this file does</strong>
            <p>{{ selectedFilePurpose }}</p>
            <ul v-if="selectedFileRoles.length">
              <li v-for="role in selectedFileRoles" :key="role.id || role.key">
                <strong>{{ role.title }}</strong>
                <span>{{ role.description || role.kind }}</span>
              </li>
            </ul>
          </div>
          <p v-if="largeFileWarning" class="system-world__large-file-warning">
            This file is structurally enormous. Its skyscraper is intentionally impossible to ignore.
          </p>
          <div v-if="fileRelations.length" class="system-world__section">
            <strong>Nearby relationships</strong>
            <div class="system-world__relationships">
              <button
                v-for="relation in fileRelations"
                :key="relation.key"
                type="button"
                @click="inspectFile(relation.file, { focus: true })"
              >
                <span>{{ relation.direction === 'out' ? 'imports →' : '← imported by' }}</span>
                <strong>{{ fileName(relation.file) }}</strong>
              </button>
            </div>
          </div>
          <div class="system-world__inspector-actions">
            <v-btn
              :prepend-icon="mdiFileCodeOutline"
              size="small"
              type="button"
              variant="tonal"
              @click="openSelectedFile"
            >
              Open in Files
            </v-btn>
            <v-btn
              :disabled="!askChatAvailable"
              :prepend-icon="mdiMessageOutline"
              size="small"
              type="button"
              variant="text"
              @click="askAboutSelection"
            >
              Ask in Chat
            </v-btn>
          </div>
        </template>
      </aside>

      <aside v-else-if="overview" class="system-world__orientation">
        <template v-if="viewMode === 'subsystems'">
          <div class="system-world__eyebrow">SEMANTIC SKY</div>
          <strong>The clouds explain why the city exists.</strong>
          <span>Selecting a cloud always illuminates the files and directory terraces it owns. Connections and Libraries are optional context layers.</span>
          <span>JSKIT supplies facts it can prove mechanically. Codex can propose the purpose and boundaries that require interpretation, and those proposals remain visible as inferred metadata.</span>
          <v-btn
            :disabled="!askChatAvailable"
            :prepend-icon="mdiLayersTripleOutline"
            size="small"
            type="button"
            variant="tonal"
            @click="discoverSubsystems"
          >
            Discover subsystems with Codex
          </v-btn>
        </template>
        <template v-else>
          <div class="system-world__eyebrow">YOUR CURRENT SESSION</div>
          <strong>The repository is the city.</strong>
          <span>Adapter-defined trees become separate campuses. Nested folders step upward as named terraced precincts, and every file remains a real LOC-sized building.</span>
          <span>In Folders view, every building inherits the exact colour of its containing directory terrace. Physical size alone reveals exceptionally large files.</span>
        </template>
      </aside>

      <div v-if="overview" class="system-world__controls-hint" aria-label="File city controls">
        <span><v-icon :icon="mdiMouse" size="13" /> Drag / arrows to move</span>
        <span><v-icon :icon="mdiMouseScrollWheel" size="13" /> 2-finger ↕ / W S forward–back</span>
        <span><v-icon :icon="mdiMouseRightClickOutline" size="13" /> 2-finger ↔ starts free orbit</span>
      </div>

      <div v-if="overview" class="system-world__legend" aria-label="File city visual legend">
        <template v-if="viewMode === 'subsystems'">
          <span><i class="system-world__legend-cloud" /> Cloud = subsystem</span>
          <span><i class="system-world__legend-owned" /> Cyan = owned code</span>
          <span v-if="showSubsystemConnections"><i class="system-world__legend-bundle" /> Gray → charcoal = more bundled uses</span>
          <span v-if="selectedSubsystemConnection"><i class="system-world__legend-last-mile" /> Amber = expanded last mile</span>
          <span v-if="showSubsystemConnections"><i class="system-world__legend-declaration" /> Dashed amber = declaration</span>
          <span v-if="showSubsystemLibraries"><i class="system-world__legend-external" /> Satellite = npm package</span>
          <span v-if="showSubsystemFileEvidence"><i class="system-world__legend-evidence" /> Building arrows = exact evidence</span>
          <span v-if="showSubsystemLibraries"><i class="system-world__legend-library-evidence" /> Purple drops = library imports</span>
        </template>
        <template v-else>
          <span><i class="system-world__legend-campus" /> Land parcel = campus</span>
          <span><i class="system-world__legend-depth" /> Higher terrace = deeper folder</span>
          <span><i class="system-world__legend-building" /> Footprint + height = LOC</span>
          <span>{{ viewLegend }}</span>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch
} from "vue";
import {
  mdiAlertOutline,
  mdiCityVariantOutline,
  mdiCodeBraces,
  mdiCrosshairsGps,
  mdiFileCodeOutline,
  mdiFolderOutline,
  mdiInformationOutline,
  mdiLayersTripleOutline,
  mdiMapOutline,
  mdiMessageOutline,
  mdiMouse,
  mdiMouseRightClickOutline,
  mdiMouseScrollWheel,
  mdiOrbit,
  mdiRefresh,
  mdiRotate3dVariant,
  mdiRotateLeft,
  mdiRotateRight
} from "@mdi/js";

import {
  useVibe64SystemGraph
} from "../composables/useVibe64SystemGraph.js";
import {
  createSystemWorld
} from "../world/createSystemWorld.js";
import {
  isVisuallyLargeFile,
  topLevelPrecincts
} from "../world/worldLayout.js";
import {
  SUBSYSTEM_DEPTH_MAX
} from "../../shared/subsystemPresentationContract.js";

const rendererRevision = "047";

const props = defineProps({
  active: {
    type: Boolean,
    default: false
  },
  askChatAvailable: {
    type: Boolean,
    default: true
  },
  restoreRequest: {
    type: Object,
    default: null
  },
  resolveRequestUrl: {
    type: Function,
    default: (value) => value
  },
  sessionId: {
    type: String,
    required: true
  }
});

const emit = defineEmits([
  "ask-in-chat",
  "open-source-file"
]);

const activeFileId = ref("");
const canvasElement = ref(null);
const editingSubsystemDepthId = ref("");
const hoveredSubsystemConnection = ref(null);
const selectedDirectory = ref(null);
const selectedSubsystemConnection = ref(null);
const selectedSubsystemId = ref("");
const showSubsystemConnections = ref(false);
const showSubsystemFileEvidence = ref(false);
const showSubsystemLibraries = ref(false);
const viewMode = ref("folders");
const worldError = ref("");
const worldView = ref("perspective");
let animationFrame = 0;
let overviewGeneration = 0;
let resizeObserver = null;
let viewRotationPointer = null;
let world = null;

const {
  error,
  fileConstellation,
  loading,
  overview,
  reload,
  savingSubsystemDepth,
  selectFile,
  setSubsystemDepth,
  startUpdate,
  systemStatus,
  updateEvents,
  updating
} = useVibe64SystemGraph({
  active: toRef(props, "active"),
  resolveRequestUrl: props.resolveRequestUrl,
  sessionId: toRef(props, "sessionId")
});

const campuses = computed(() => overview.value ? topLevelPrecincts(overview.value) : []);
const subsystems = computed(() => overview.value?.subsystems || []);
const selectedSubsystem = computed(() => (
  subsystems.value.find((subsystem) => subsystem.id === selectedSubsystemId.value) || null
));
const subsystemDepthLevels = Object.freeze(
  Array.from({ length: SUBSYSTEM_DEPTH_MAX + 1 }, (_, depth) => depth)
);
const selectedSubsystemDependencies = computed(() => (
  selectedSubsystem.value?.dependencies || { external: [], incoming: [], outgoing: [] }
));
const selectedSubsystemRelationshipSections = computed(() => ([
  {
    dependencies: subsystemRelationshipDependencies(selectedSubsystemDependencies.value.outgoing),
    direction: "outgoing",
    title: "Outgoing subsystem connections"
  },
  {
    dependencies: subsystemRelationshipDependencies(selectedSubsystemDependencies.value.incoming),
    direction: "incoming",
    title: "Incoming subsystem connections"
  }
].filter((section) => section.dependencies.length > 0)));
const cityFilesById = computed(() => new Map(
  (overview.value?.files || []).map((file) => [file.id, file])
));
const selectedSubsystemConnectionFiles = computed(() => (
  (selectedSubsystemConnection.value?.consumerFileIds || [])
    .map((fileId) => cityFilesById.value.get(fileId))
    .filter(Boolean)
));
const selectedSubsystemConnectionProviderFiles = computed(() => (
  (selectedSubsystemConnection.value?.providerFileIds || [])
    .map((fileId) => cityFilesById.value.get(fileId))
    .filter(Boolean)
));
const hoveredSubsystemConnectionProviderFiles = computed(() => (
  (hoveredSubsystemConnection.value?.providerFileIds || [])
    .map((fileId) => cityFilesById.value.get(fileId))
    .filter(Boolean)
));
const selectedSubsystemConnectionFile = computed(() => {
  if (!selectedSubsystemConnection.value?.consumerFileIds.includes(activeFileId.value)) {
    return null;
  }
  return cityFilesById.value.get(activeFileId.value) || null;
});

function subsystemRelationshipDependencies(dependencies = []) {
  return dependencies.map((dependency) => ({
    ...dependency,
    fileConnections: (dependency.fileConnections || []).map((connection) => ({
      ...connection,
      injectionTokens: connection.injectionTokens || []
    })),
    injectionTokens: dependency.injectionTokens || [],
    symbols: dependency.symbols || []
  }));
}
const selectedFile = computed(() => (
  activeFileId.value && fileConstellation.value?.selectedFile?.id === activeFileId.value
    ? fileConstellation.value.selectedFile
    : null
));
const selectedCityFile = computed(() => (
  (overview.value?.files || []).find((file) => file.id === activeFileId.value) || selectedFile.value || null
));
const selectedFileName = computed(() => fileName(selectedFile.value));
const selectedFileSubsystem = computed(() => (
  selectedCityFile.value?.subsystemTitle ||
  fileConstellation.value?.entities?.find((entity) => entity.kind === "subsystem")?.title ||
  "Unassigned"
));
const selectedFileRoles = computed(() => (
  (fileConstellation.value?.entities || []).filter((entity) => entity.kind !== "subsystem")
));
const selectedFilePurpose = computed(() => (
  selectedFileRoles.value.find((role) => role.description)?.description ||
  selectedCityFile.value?.purpose ||
  selectedCityFile.value?.subsystemDescription ||
  "Its purpose has not been described yet. Ask in Chat to investigate it from evidence."
));
const selectedFileImportedBy = computed(() => (
  selectedCityFile.value?.importedByCount ??
  (fileConstellation.value?.edges || []).filter((edge) => edge.toFileId === selectedFile.value?.id).length
));
const largeFileWarning = computed(() => Boolean(
  selectedFile.value && isVisuallyLargeFile(
    selectedFile.value.lines,
    overview.value?.lineStats?.largest || fileConstellation.value?.documentLineStats?.largest
  )
));
const fileRelations = computed(() => {
  const selectedId = selectedFile.value?.id;
  const filesById = new Map((fileConstellation.value?.files || []).map((file) => [file.id, file]));
  const relations = [];
  const seen = new Set();
  for (const edge of fileConstellation.value?.edges || []) {
    const direction = edge.fromFileId === selectedId ? "out" : edge.toFileId === selectedId ? "in" : "";
    const otherId = direction === "out" ? edge.toFileId : direction === "in" ? edge.fromFileId : "";
    const file = filesById.get(otherId);
    if (!direction || !file || seen.has(`${direction}:${otherId}`)) {
      continue;
    }
    seen.add(`${direction}:${otherId}`);
    relations.push({
      direction,
      file,
      key: `${direction}:${otherId}`
    });
  }
  return relations.slice(0, 10);
});
const latestUpdateEvent = computed(() => updateEvents.value.at(-1) || null);
const latestUpdateLabel = computed(() => {
  const type = latestUpdateEvent.value?.type || "";
  if (type === "system-update.analysis-started") {
    return `Rebuilding from ${latestUpdateEvent.value.changedPaths || 0} changed paths…`;
  }
  if (type === "system-update.source-raced") {
    return "Source changed during analysis; retrying safely…";
  }
  if (type === "system-update.writing") {
    return "Writing the current file map…";
  }
  if (type === "system-update.completed") {
    return "Current file city ready.";
  }
  if (type.endsWith("failed")) {
    return latestUpdateEvent.value.error?.message || "File City update failed.";
  }
  return updating.value ? "Refreshing the current file city…" : "";
});
const statusLabel = computed(() => {
  if (overview.value) {
    const files = overview.value.lineStats?.files || overview.value.files?.length || 0;
    const lines = overview.value.lineStats?.total || 0;
    return `${files.toLocaleString()} files · ${formatLines(lines)} lines`;
  }
  return String(systemStatus.value.status || "loading").replaceAll("_", " ");
});
const viewLegend = computed(() => ({
  folders: "Color = containing directory terrace",
  runtime: "Color = client / server / shared",
  subsystems: "Cloud = subsystem · lines = code anchors"
}[viewMode.value]));

function fileName(file = {}) {
  return String(file?.path || "File").split("/").pop();
}

function pathFileName(filePath = "") {
  return String(filePath || "Unknown file").split("/").pop();
}

function formatLines(value = 0) {
  return Math.max(0, Number(value) || 0).toLocaleString();
}

function formatCount(value = 0, singular = "item", plural = `${singular}s`) {
  const count = Math.max(0, Number(value) || 0);
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function dependencySummary(dependencies = {}) {
  const outgoing = dependencies?.outgoing?.length || 0;
  const incoming = dependencies?.incoming?.length || 0;
  const external = dependencies?.external?.length || 0;
  return `out ${outgoing} · in ${incoming} · external ${external}`;
}

function dependencyEvidenceLabel(dependency = {}) {
  const imports = Math.max(0, Number(dependency.importCount) || 0);
  const injections = Math.max(0, Number(dependency.injectionCount) || 0);
  const files = Math.max(0, Number(dependency.fileCount) || 0);
  const evidence = [];
  if (imports) {
    evidence.push(formatCount(imports, "import"));
  }
  if (injections) {
    evidence.push(formatCount(injections, "injection"));
  }
  if (dependency.declared) {
    evidence.push("declared");
  }
  return evidence.length > 0
    ? `${evidence.join(" + ")}${files ? ` from ${formatCount(files, "file")}` : ""}`
    : "connection";
}

function renderFrame(time) {
  animationFrame = 0;
  world?.frame(time);
  if (props.active && world) {
    animationFrame = requestAnimationFrame(renderFrame);
  }
}

function startRenderLoop() {
  if (!animationFrame && props.active && world) {
    animationFrame = requestAnimationFrame(renderFrame);
  }
}

function stopRenderLoop() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function resizeWorld() {
  const canvas = canvasElement.value;
  if (!canvas || !world) {
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  world.resize(bounds.width, bounds.height);
}

async function handleFilePick(selection) {
  if (!selection.fileKey) {
    return;
  }
  const preserveSubsystemSelection = selection.preserveSubsystemSelection === true &&
    selection.subsystemConnectionId === selectedSubsystemConnection.value?.id;
  selectedDirectory.value = null;
  if (!preserveSubsystemSelection) {
    editingSubsystemDepthId.value = "";
    selectedSubsystemConnection.value = null;
    selectedSubsystemId.value = "";
  }
  activeFileId.value = selection.fileId;
  const response = await selectFile(selection.fileKey);
  const constellation = response?.constellation || fileConstellation.value;
  if (constellation && activeFileId.value === selection.fileId) {
    if (!preserveSubsystemSelection) {
      world?.setFileContext(constellation);
    }
  }
}

function handleDirectoryPick(directory) {
  activeFileId.value = "";
  editingSubsystemDepthId.value = "";
  selectedSubsystemConnection.value = null;
  selectedSubsystemId.value = "";
  selectedDirectory.value = directory;
}

function handlePrecinctPick(campus) {
  activeFileId.value = "";
  editingSubsystemDepthId.value = "";
  selectedSubsystemConnection.value = null;
  selectedSubsystemId.value = "";
  selectedDirectory.value = campus;
}

function handleSubsystemPick(subsystem) {
  activeFileId.value = "";
  editingSubsystemDepthId.value = "";
  selectedSubsystemConnection.value = null;
  selectedDirectory.value = null;
  selectedSubsystemId.value = subsystem.id;
}

function handleSubsystemDepthEdit(subsystem) {
  if (!subsystem?.id) {
    return;
  }
  selectedSubsystemId.value = subsystem.id;
  editingSubsystemDepthId.value = subsystem.id;
}

async function shiftSelectedSubsystemDepth(change) {
  if (!selectedSubsystem.value?.key || savingSubsystemDepth.value) {
    return;
  }
  const currentDepth = Number(selectedSubsystem.value.depth) || 0;
  const nextDepth = Math.max(0, Math.min(SUBSYSTEM_DEPTH_MAX, currentDepth + change));
  if (nextDepth === currentDepth) {
    return;
  }
  worldError.value = "";
  try {
    await setSubsystemDepth(selectedSubsystem.value.key, nextDepth);
  } catch (caught) {
    worldError.value = String(caught?.message || caught || "Subsystem stratum could not be saved.");
  }
}

function handleSubsystemConnectionPick(connection) {
  selectedSubsystemConnection.value = connection;
  activeFileId.value = "";
}

function handleClearSelection() {
  activeFileId.value = "";
  editingSubsystemDepthId.value = "";
  selectedDirectory.value = null;
  selectedSubsystemConnection.value = null;
  selectedSubsystemId.value = "";
}

async function createWorld() {
  if (!canvasElement.value || world) {
    return;
  }
  try {
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    world = createSystemWorld({
      canvas: canvasElement.value,
      onClearSelection: handleClearSelection,
      onEditSubsystemDepth: handleSubsystemDepthEdit,
      onHoverSubsystemConnection: (connection) => {
        hoveredSubsystemConnection.value = connection;
      },
      onSelectDirectory: handleDirectoryPick,
      onSelectFile: (selection) => void handleFilePick(selection),
      onSelectPrecinct: handlePrecinctPick,
      onSelectSubsystem: handleSubsystemPick,
      onSelectSubsystemConnection: handleSubsystemConnectionPick,
      reducedMotion
    });
    resizeObserver = new ResizeObserver(resizeWorld);
    resizeObserver.observe(canvasElement.value);
    resizeWorld();
    startRenderLoop();
    if (overview.value) {
      await world.setOverview(overview.value);
      world.setSubsystemLayers({
        connections: showSubsystemConnections.value,
        fileEvidence: showSubsystemFileEvidence.value,
        libraries: showSubsystemLibraries.value
      });
      world.setViewMode(viewMode.value);
    }
    if (props.restoreRequest) {
      await applyRestoreRequest(props.restoreRequest);
    }
  } catch (caught) {
    worldError.value = String(caught?.message || caught || "WebGL could not start.");
  }
}

async function applyOverview(nextOverview) {
  if (!world || !nextOverview) {
    return;
  }
  const generation = ++overviewGeneration;
  const previousView = world.captureView();
  try {
    await world.setOverview(nextOverview);
    if (generation !== overviewGeneration) {
      return;
    }
    if (selectedSubsystemConnection.value) {
      selectedSubsystemConnection.value = null;
      activeFileId.value = "";
    }
    world.setSubsystemLayers({
      connections: showSubsystemConnections.value,
      fileEvidence: showSubsystemFileEvidence.value,
      libraries: showSubsystemLibraries.value
    });
    world.setViewMode(viewMode.value);
    if (fileConstellation.value && activeFileId.value) {
      world.setFileContext(fileConstellation.value);
    } else if (selectedDirectory.value) {
      if (selectedDirectory.value.kind === "campus") {
        world.selectPrecinct(selectedDirectory.value.id);
      } else {
        world.selectDirectory(selectedDirectory.value.path);
      }
    } else if (selectedSubsystem.value) {
      world.selectSubsystem(selectedSubsystem.value.id);
    }
    if (previousView.position) {
      world.restoreView(previousView);
    }
  } catch (caught) {
    worldError.value = String(caught?.message || caught);
  }
}

function selectCampus(campus) {
  activeFileId.value = "";
  editingSubsystemDepthId.value = "";
  selectedSubsystemConnection.value = null;
  selectedSubsystemId.value = "";
  selectedDirectory.value = campus;
  world?.selectPrecinct(campus.id);
  world?.focusPrecinct(campus.id);
}

function inspectSubsystem(subsystem, { focus = false } = {}) {
  if (!subsystem?.id) {
    return;
  }
  activeFileId.value = "";
  editingSubsystemDepthId.value = "";
  selectedSubsystemConnection.value = null;
  selectedDirectory.value = null;
  selectedSubsystemId.value = subsystem.id;
  world?.selectSubsystem(subsystem.id);
  if (focus) {
    world?.focusSubsystem(subsystem.id);
  }
}

function inspectSubsystemConnectionFile(file) {
  if (!file?.key || !selectedSubsystemConnection.value) {
    return;
  }
  if (!world?.selectSubsystemConnectionFile(file.id)) {
    return;
  }
  world.focusFile(file.id);
  void handleFilePick({
    fileId: file.id,
    fileKey: file.key,
    path: file.path,
    preserveSubsystemSelection: true,
    subsystemConnectionId: selectedSubsystemConnection.value.id
  });
}

function focusSubsystemDependency(dependency, direction) {
  if (!selectedSubsystem.value || !dependency?.subsystemId) {
    return;
  }
  showSubsystemConnections.value = true;
  world?.setSubsystemLayers({
    connections: true,
    fileEvidence: showSubsystemFileEvidence.value,
    libraries: showSubsystemLibraries.value
  });
  const outgoing = direction === "outgoing";
  world?.focusSubsystemDependency(
    outgoing ? selectedSubsystem.value.id : dependency.subsystemId,
    outgoing ? dependency.subsystemId : selectedSubsystem.value.id
  );
}

function inspectFile(file, { focus = false } = {}) {
  if (!file?.key) {
    return;
  }
  world?.selectFile(file.id);
  if (focus) {
    world?.focusFile(file.id);
  }
  void handleFilePick({
    fileId: file.id,
    fileKey: file.key,
    path: file.path
  });
}

function fitWorld() {
  void world?.fitWorld();
}

function setWorldView(view) {
  worldView.value = view;
  world?.setView(view);
}

function rotateWorld(degrees) {
  world?.rotateView(degrees, 0, true);
}

function startViewRotation(event) {
  if (event.button !== 0) {
    return;
  }
  event.currentTarget.setPointerCapture?.(event.pointerId);
  viewRotationPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
  event.preventDefault();
}

function continueViewRotation(event) {
  if (!viewRotationPointer || viewRotationPointer.id !== event.pointerId) {
    return;
  }
  const horizontalDelta = event.clientX - viewRotationPointer.x;
  const verticalDelta = event.clientY - viewRotationPointer.y;
  viewRotationPointer.x = event.clientX;
  viewRotationPointer.y = event.clientY;
  world?.rotateView(-horizontalDelta * 0.45, -verticalDelta * 0.28, false);
  event.preventDefault();
}

function endViewRotation(event) {
  if (!viewRotationPointer || viewRotationPointer.id !== event.pointerId) {
    return;
  }
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  viewRotationPointer = null;
}

function setViewMode(mode) {
  viewMode.value = mode;
  world?.setViewMode(mode);
}

function toggleSubsystemLayer(layer) {
  if (layer === "connections") {
    showSubsystemConnections.value = !showSubsystemConnections.value;
    if (!showSubsystemConnections.value) {
      showSubsystemFileEvidence.value = false;
    }
  } else if (layer === "file-evidence") {
    showSubsystemFileEvidence.value = !showSubsystemFileEvidence.value;
  } else if (layer === "libraries") {
    showSubsystemLibraries.value = !showSubsystemLibraries.value;
  }
  world?.setSubsystemLayers({
    connections: showSubsystemConnections.value,
    fileEvidence: showSubsystemFileEvidence.value,
    libraries: showSubsystemLibraries.value
  });
}

function updateSystem() {
  void startUpdate();
}

function sourceNavigationContext() {
  return {
    camera: world?.captureView() || null,
    mode: "city",
    selectedCampusId: selectedDirectory.value?.kind === "campus" ? selectedDirectory.value.id : "",
    selectedDirectoryPath: selectedDirectory.value?.kind === "campus" ? null : selectedDirectory.value?.path ?? null,
    selectedFileKey: selectedFile.value?.key || "",
    selectedSubsystemId: selectedSubsystem.value?.id || "",
    subsystemConnectionsVisible: showSubsystemConnections.value,
    subsystemFileEvidenceVisible: showSubsystemFileEvidence.value,
    subsystemLibrariesVisible: showSubsystemLibraries.value,
    viewMode: viewMode.value,
    view: worldView.value
  };
}

function openSelectedFile() {
  if (!selectedFile.value) {
    return;
  }
  emit("open-source-file", {
    origin: "system",
    path: selectedFile.value.path,
    systemContext: sourceNavigationContext()
  });
}

function selectionPrompt() {
  if (selectedSubsystem.value) {
    return [
      "I am looking at this subsystem in Vibe64 File City:",
      `- Subsystem: ${selectedSubsystem.value.title} (${selectedSubsystem.value.id})`,
      `- Meaning: ${selectedSubsystem.value.description || "not described yet"}`,
      `- Provenance: ${selectedSubsystem.value.origin}; status: ${selectedSubsystem.value.status}; authored by: ${selectedSubsystem.value.authoredBy}`,
      `- Execution side: ${selectedSubsystem.value.executionSide}`,
      `- Current size: ${selectedSubsystem.value.fileCount} files, ${selectedSubsystem.value.lines} lines`,
      `- Anchors: ${selectedSubsystem.value.anchors.map((anchor) => `${anchor.relation} ${anchor.kind} ${anchor.path}`).join("; ")}`,
      `- Capabilities: ${selectedSubsystem.value.capabilities.map((capability) => `${capability.direction} ${capability.kind} ${capability.value || capability.title}`).join("; ") || "none recorded"}`,
      `- Uses subsystems: ${selectedSubsystemDependencies.value.outgoing.map((dependency) => dependency.title).join(", ") || "none"}`,
      `- Used by subsystems: ${selectedSubsystemDependencies.value.incoming.map((dependency) => dependency.title).join(", ") || "none"}`,
      `- External npm packages: ${selectedSubsystemDependencies.value.external.map((dependency) => dependency.title).join(", ") || "none"}`,
      "",
      "Please explain this subsystem in plain language and assess whether its boundary, name, purpose, and capabilities match the source evidence. Do not change source code. If metadata should change, propose the exact checked-in vibe64.system.json declaration first."
    ].join("\n");
  }
  if (selectedDirectory.value) {
    const campusSelected = selectedDirectory.value.kind === "campus";
    return [
      `I am looking at this ${campusSelected ? "campus" : "directory precinct"} in Vibe64 File City:`,
      `- ${campusSelected ? "Campus" : "Directory"}: ${selectedDirectory.value.name}`,
      `- Source root: ${selectedDirectory.value.path || "everything not claimed by another campus"}`,
      `- Files below it: ${selectedDirectory.value.fileCount}`,
      `- Total physical size: ${selectedDirectory.value.lines} lines`,
      `- Subsystems represented: ${selectedDirectory.value.subsystems.map((entry) => entry.title).join(", ") || "not yet assigned"}`,
      "",
      "Please explain, in plain language, what belongs here and whether the directory and subsystem boundaries make sense. Do not change code until I explicitly ask."
    ].join("\n");
  }
  if (selectedFile.value) {
    return [
      "I am looking at this building in Vibe64 File City:",
      `- File: ${selectedFile.value.path}`,
      `- Physical size: ${selectedFile.value.lines} lines`,
      `- Known purpose: ${selectedFilePurpose.value}`,
      `- Owning subsystem: ${selectedFileSubsystem.value}`,
      `- Imports: ${selectedFile.value.imports.length}; imported by: ${selectedFileImportedBy.value}`,
      "",
      "Please explain what this file does and whether it is in the right place. If its purpose or subsystem needs annotation, propose the checked-in metadata change. Do not change code until I explicitly ask."
    ].join("\n");
  }
  return "Please help me understand the current repository shown in Vibe64 File City. Do not change code until I explicitly ask.";
}

function askAboutSelection() {
  emit("ask-in-chat", {
    prompt: selectionPrompt().slice(0, 5000)
  });
}

function subsystemDiscoveryPrompt() {
  return [
    "Please discover meaningful subsystems in this current Vibe64 session.",
    "",
    "Work from source evidence and the existing adapter-derived subsystem facts. A subsystem is a coherent responsibility that may own, implement, support, or configure one or more real files or directories. Look especially for responsibilities that cross directory boundaries, and do not merely restate every folder.",
    "",
    "Do not change application source code. Update only the declarations array in the checked-in vibe64.system.json current-state document, preserving adapter-derived tables. For each Codex-authored declaration use kind: subsystem, authoredBy: codex, origin: inferred, and status: proposed. Include a stable id, plain-language title and description, executionSide, evidence-backed anchors, and flexible capabilities.",
    "",
    "Anchors must use kind file or directory; relation owns, implements, supports, or configures; a project-relative path; origin inferred; and evidenceIds when available. Capabilities must include a stable id, open-ended kind, direction provides or requires, title, and evidence such as value, description, or sourcePath. Do not assign the exact same owns anchor to two subsystems. Prefer the smallest coherent boundaries.",
    "",
    "When finished, summarize what you proposed and why. I will use Refresh map in File City to reconcile the visual world."
  ].join("\n");
}

function discoverSubsystems() {
  emit("ask-in-chat", {
    prompt: subsystemDiscoveryPrompt().slice(0, 5000)
  });
}

async function applyRestoreRequest(request) {
  if (!request || !world || !overview.value) {
    return;
  }
  if (request.viewMode || request.colorMode) {
    setViewMode(request.viewMode || request.colorMode);
  }
  showSubsystemConnections.value = request.subsystemConnectionsVisible === true;
  showSubsystemFileEvidence.value = showSubsystemConnections.value && request.subsystemFileEvidenceVisible === true;
  showSubsystemLibraries.value = request.subsystemLibrariesVisible === true;
  world.setSubsystemLayers({
    connections: showSubsystemConnections.value,
    fileEvidence: showSubsystemFileEvidence.value,
    libraries: showSubsystemLibraries.value
  });
  if (request.selectedFileKey) {
    const response = await selectFile(request.selectedFileKey);
    const constellation = response?.constellation || fileConstellation.value;
    if (constellation?.selectedFile) {
      activeFileId.value = constellation.selectedFile.id;
      selectedDirectory.value = null;
      world.setFileContext(constellation);
    }
  } else if (request.selectedCampusId) {
    const campus = campuses.value.find((entry) => entry.id === request.selectedCampusId);
    if (campus) {
      selectedDirectory.value = campus;
      activeFileId.value = "";
      world.selectPrecinct(campus.id);
    }
  } else if (request.selectedSubsystemId) {
    const subsystem = subsystems.value.find((entry) => entry.id === request.selectedSubsystemId);
    if (subsystem) {
      selectedSubsystemId.value = subsystem.id;
      selectedDirectory.value = null;
      activeFileId.value = "";
      world.selectSubsystem(subsystem.id);
    }
  }
  worldView.value = request.view || "perspective";
  if (!world.restoreView(request.camera || {})) {
    if (activeFileId.value) {
      world.focusFile(activeFileId.value);
    } else if (selectedDirectory.value) {
      if (selectedDirectory.value.kind === "campus") {
        world.focusPrecinct(selectedDirectory.value.id);
      } else {
        world.focusDirectory(selectedDirectory.value.path);
      }
    } else if (selectedSubsystem.value) {
      world.focusSubsystem(selectedSubsystem.value.id);
    }
  }
}

watch(overview, (nextOverview) => {
  void applyOverview(nextOverview);
});

watch(() => props.active, (isActive) => {
  world?.setActive(isActive);
  if (isActive) {
    startRenderLoop();
    void nextTick(resizeWorld);
  } else {
    stopRenderLoop();
  }
}, { immediate: true });

watch(() => props.restoreRequest?.sequence || 0, () => {
  if (props.restoreRequest) {
    void applyRestoreRequest(props.restoreRequest);
  }
});

onMounted(() => {
  void createWorld();
});

onBeforeUnmount(() => {
  stopRenderLoop();
  resizeObserver?.disconnect?.();
  world?.dispose();
  world = null;
});
</script>

<style scoped>
.system-world {
  --city-blue: #56d8ff;
  --city-orange: #ff6b31;
  background: #050914;
  color: #f5f8ff;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.system-world__toolbar {
  align-items: center;
  backdrop-filter: blur(18px);
  background: rgba(5, 9, 20, 0.92);
  border-bottom: 1px solid rgba(146, 177, 229, 0.15);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(10rem, 1fr) auto minmax(10rem, 1fr);
  min-height: 3.2rem;
  padding: 0.42rem 0.68rem;
  position: relative;
  z-index: 20;
}

.system-world__identity,
.system-world__view-actions,
.system-world__mode-switch {
  align-items: center;
  display: flex;
}

.system-world__identity { gap: 0.55rem; }
.system-world__identity > div { display: grid; line-height: 1.05; }
.system-world__identity strong { font-size: 0.86rem; letter-spacing: 0.07em; text-transform: uppercase; }
.system-world__identity span:not(.system-world__mark) { color: rgba(220, 232, 255, 0.55); font-size: 0.65rem; margin-top: 0.22rem; }
.system-world__mark {
  align-items: center;
  background: linear-gradient(135deg, rgba(53, 208, 255, 0.26), rgba(129, 88, 255, 0.2));
  border: 1px solid rgba(118, 221, 255, 0.42);
  border-radius: 0.65rem;
  box-shadow: 0 0 1.5rem rgba(53, 208, 255, 0.14);
  display: inline-flex;
  height: 2rem;
  justify-content: center;
  width: 2rem;
}

.system-world__mode-switch {
  background: rgba(123, 148, 191, 0.09);
  border: 1px solid rgba(140, 169, 221, 0.12);
  border-radius: 0.7rem;
  padding: 0.1rem;
}

.system-world__mode-switch > span {
  color: rgba(214, 227, 250, 0.48);
  font-size: 0.56rem;
  padding: 0 0.35rem;
  text-transform: uppercase;
}

.system-world__view-actions { gap: 0.1rem; justify-content: flex-end; }
.system-world__stage { isolation: isolate; min-height: 0; overflow: hidden; position: relative; }
.system-world__layer-controls { align-items: center; backdrop-filter: blur(14px); background: rgba(7, 13, 27, 0.9); border: 1px solid rgba(132, 164, 219, 0.2); border-radius: 0.55rem; display: flex; gap: 0.2rem; left: 50%; padding: 0.18rem; position: absolute; top: 0.65rem; transform: translateX(-50%); z-index: 10; }
.system-world__layer-controls > span { color: rgba(218, 232, 255, 0.44); font-size: 0.48rem; padding: 0 0.28rem; text-transform: uppercase; }
.system-world__layer-controls > button { background: rgba(123, 148, 191, 0.08); border: 1px solid transparent; border-radius: 0.38rem; color: rgba(218, 232, 255, 0.66); cursor: pointer; font: inherit; font-size: 0.52rem; padding: 0.3rem 0.48rem; }
.system-world__layer-controls > button:hover,
.system-world__layer-controls > button:focus-visible { background: rgba(93, 188, 238, 0.14); color: #fff; }
.system-world__layer-controls > button.system-world__layer-control--active { background: rgba(83, 205, 241, 0.2); border-color: rgba(103, 223, 255, 0.42); color: #fff; }
.system-world__layer-controls > button:disabled { cursor: default; opacity: 0.34; }

.system-world__canvas {
  background:
    radial-gradient(circle at 24% 38%, rgba(31, 109, 153, 0.2), transparent 34%),
    radial-gradient(circle at 78% 52%, rgba(91, 41, 151, 0.17), transparent 32%),
    linear-gradient(#080e1e, #040711);
  cursor: move;
  display: block;
  height: 100%;
  outline: none;
  width: 100%;
}

.system-world__canvas:active { cursor: grabbing; }
.system-world__canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--city-blue); }

.system-world__connection-tooltip {
  background: rgba(5, 9, 18, 0.96);
  border: 1px solid rgba(241, 245, 249, 0.42);
  border-radius: 0.55rem;
  box-shadow: 0 0.8rem 2.4rem rgba(0, 0, 0, 0.42);
  display: grid;
  gap: 0.16rem;
  max-width: 16rem;
  padding: 0.48rem 0.58rem;
  pointer-events: none;
  position: absolute;
  transform: translateY(-100%);
  z-index: 14;
}
.system-world__connection-tooltip > span { color: rgba(120, 222, 255, 0.72); font-size: 0.48rem; letter-spacing: 0.08em; text-transform: uppercase; }
.system-world__connection-tooltip > strong { color: #fff; font-size: 0.65rem; overflow-wrap: anywhere; }
.system-world__connection-tooltip > code { color: rgba(218, 230, 248, 0.66); font-size: 0.5rem; overflow-wrap: anywhere; }
.system-world__connection-tooltip > small { color: rgba(255, 224, 138, 0.68); font-size: 0.5rem; margin-top: 0.12rem; }

.system-world__state-card {
  align-items: center;
  backdrop-filter: blur(24px);
  background: rgba(8, 14, 31, 0.9);
  border: 1px solid rgba(114, 183, 228, 0.24);
  border-radius: 1.2rem;
  box-shadow: 0 1.5rem 5rem rgba(0, 0, 0, 0.42);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  left: 50%;
  max-width: 31rem;
  padding: 1.6rem 2rem;
  position: absolute;
  text-align: center;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 12;
}

.system-world__state-card > span { color: rgba(223, 234, 255, 0.64); font-size: 0.79rem; }
.system-world__state-card--error { border-color: rgba(255, 93, 120, 0.46); }
.system-world__state-orbit {
  animation: system-orbit 1.3s linear infinite;
  border: 2px solid rgba(53, 208, 255, 0.16);
  border-right-color: var(--city-blue);
  border-radius: 50%;
  height: 2.5rem;
  width: 2.5rem;
}
@keyframes system-orbit { to { transform: rotate(1turn); } }

.system-world__stale,
.system-world__progress {
  align-items: center;
  backdrop-filter: blur(12px);
  border-radius: 999px;
  display: flex;
  font-size: 0.68rem;
  gap: 0.42rem;
  left: 50%;
  padding: 0.4rem 0.72rem;
  position: absolute;
  transform: translateX(-50%);
  z-index: 8;
}

.system-world__stale { background: rgba(108, 61, 8, 0.86); border: 1px solid rgba(255, 183, 70, 0.4); top: 0.75rem; }
.system-world__stale span,
.system-world__progress-pulse { background: #ffb84d; border-radius: 50%; height: 0.42rem; width: 0.42rem; }
.system-world__progress { background: rgba(11, 28, 48, 0.88); border: 1px solid rgba(53, 208, 255, 0.3); bottom: 5.25rem; }
.system-world__progress-pulse { animation: system-pulse 1s ease-in-out infinite; background: var(--city-blue); box-shadow: 0 0 0.65rem var(--city-blue); }
@keyframes system-pulse { 50% { opacity: 0.25; transform: scale(0.7); } }

.system-world__view-gizmo {
  align-items: center;
  background: rgba(7, 13, 27, 0.9);
  border: 1px solid rgba(125, 201, 239, 0.26);
  border-radius: 999px;
  bottom: 2.55rem;
  display: flex;
  gap: 0.2rem;
  left: 50%;
  padding: 0.22rem;
  position: absolute;
  transform: translateX(-50%);
  z-index: 9;
}

.system-world__view-gizmo button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 50%;
  color: rgba(224, 239, 255, 0.72);
  cursor: pointer;
  display: inline-flex;
  height: 1.75rem;
  justify-content: center;
  padding: 0;
  width: 1.75rem;
}

.system-world__view-gizmo button:hover,
.system-world__view-gizmo button:focus-visible {
  background: rgba(86, 216, 255, 0.15);
  color: #fff;
  outline: none;
}

.system-world__view-gizmo-puck {
  border: 1px solid rgba(86, 216, 255, 0.34) !important;
  cursor: grab !important;
  position: relative;
  touch-action: none;
}

.system-world__view-gizmo-puck:active { cursor: grabbing !important; }
.system-world__view-gizmo-puck span {
  color: var(--city-blue);
  font-size: 0.42rem;
  font-weight: 800;
  left: 50%;
  line-height: 1;
  position: absolute;
  top: 0.08rem;
  transform: translateX(-50%);
}

.system-world__navigator {
  backdrop-filter: blur(16px);
  background: rgba(7, 13, 27, 0.78);
  border: 1px solid rgba(132, 164, 219, 0.16);
  border-radius: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  left: 0.7rem;
  max-height: calc(100% - 7.5rem);
  overflow-y: auto;
  padding: 0.36rem;
  position: absolute;
  top: 0.7rem;
  width: min(13rem, 24%);
  z-index: 8;
}

.system-world__navigator header { align-items: center; color: rgba(218, 232, 255, 0.52); display: flex; font-size: 0.57rem; justify-content: space-between; letter-spacing: 0.12em; padding: 0.32rem 0.45rem; text-transform: uppercase; }
.system-world__navigator button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 0.5rem;
  color: rgba(231, 239, 255, 0.76);
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 0.42rem;
  grid-template-columns: auto 1fr;
  padding: 0.38rem 0.42rem;
  text-align: left;
}
.system-world__navigator button:hover,
.system-world__navigator button:focus-visible,
.system-world__navigator-button--active { background: rgba(93, 188, 238, 0.14) !important; color: #fff !important; }
.system-world__navigator button > span { display: grid; min-width: 0; }
.system-world__navigator button strong { font-size: 0.65rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.system-world__navigator button small { color: rgba(201, 218, 242, 0.46); font-size: 0.53rem; }

.system-world__inspector,
.system-world__orientation {
  backdrop-filter: blur(22px);
  background: linear-gradient(155deg, rgba(11, 20, 40, 0.96), rgba(6, 10, 23, 0.92));
  border: 1px solid rgba(141, 176, 230, 0.21);
  border-radius: 1rem;
  box-shadow: 0 1.2rem 4rem rgba(0, 0, 0, 0.34);
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  width: min(23rem, 36%);
  z-index: 10;
}

.system-world__inspector { max-height: calc(100% - 6.7rem); overflow-y: auto; padding: 1rem; }
.system-world__orientation { display: grid; gap: 0.38rem; padding: 0.9rem 1rem; width: min(20rem, 32%); }
.system-world__orientation > strong { font-size: 0.84rem; }
.system-world__orientation > span { color: rgba(216, 230, 250, 0.62); font-size: 0.68rem; line-height: 1.45; }
.system-world__eyebrow { color: var(--city-blue); font-size: 0.58rem; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; }
.system-world__inspector h2 { font-size: 1.08rem; line-height: 1.22; margin: 0.3rem 0 0.42rem; }
.system-world__inspector p { color: rgba(225, 235, 255, 0.7); font-size: 0.72rem; line-height: 1.48; }
.system-world__path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }

.system-world__chips,
.system-world__metrics,
.system-world__inspector-actions { display: flex; flex-wrap: wrap; gap: 0.42rem; }
.system-world__chips span { background: rgba(114, 157, 223, 0.12); border: 1px solid rgba(127, 178, 236, 0.16); border-radius: 999px; color: rgba(226, 238, 255, 0.8); font-size: 0.58rem; padding: 0.22rem 0.48rem; text-transform: uppercase; }
.system-world__metrics { border-bottom: 1px solid rgba(133, 166, 220, 0.12); border-top: 1px solid rgba(133, 166, 220, 0.12); margin: 0.75rem 0; padding: 0.58rem 0; }
.system-world__metrics span { color: rgba(208, 222, 248, 0.58); display: grid; font-size: 0.56rem; min-width: 4.6rem; text-transform: uppercase; }
.system-world__metrics strong { color: #fff; font-size: 0.78rem; }
.system-world__inspector-actions { margin-top: 0.8rem; }
.system-world__stratum-hint {
  border-left: 2px solid rgba(94, 218, 255, 0.42);
  font-size: 0.62rem !important;
  margin: 0.7rem 0;
  padding-left: 0.55rem;
}
.system-world__stratum-editor {
  align-items: start;
  background: linear-gradient(145deg, rgba(62, 205, 255, 0.12), rgba(78, 99, 174, 0.08));
  border: 1px solid rgba(103, 223, 255, 0.3);
  border-radius: 0.72rem;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: minmax(0, 1fr) auto;
  margin: 0.72rem 0;
  padding: 0.65rem;
}
.system-world__stratum-editor strong { display: block; font-size: 0.75rem; margin-top: 0.2rem; }
.system-world__stratum-editor p { font-size: 0.6rem; margin: 0.26rem 0 0; }
.system-world__stratum-controls { align-items: stretch; display: grid; gap: 0.28rem; justify-items: stretch; }
.system-world__stratum-scale {
  align-items: center;
  display: flex;
  gap: 0.22rem;
  justify-content: center;
  padding: 0.05rem 0;
}
.system-world__stratum-scale span {
  align-items: center;
  background: rgba(178, 208, 243, 0.1);
  border: 1px solid rgba(178, 208, 243, 0.16);
  border-radius: 999px;
  color: rgba(218, 232, 250, 0.55);
  display: inline-flex;
  font-size: 0.52rem;
  height: 1.25rem;
  justify-content: center;
  width: 1.25rem;
}
.system-world__stratum-scale .system-world__stratum-level--active {
  background: #67dcff;
  border-color: #b9f1ff;
  color: #06101b;
  font-weight: 800;
}

.system-world__section { border-top: 1px solid rgba(133, 166, 220, 0.12); margin-top: 0.7rem; padding-top: 0.65rem; }
.system-world__section > strong { display: block; font-size: 0.64rem; letter-spacing: 0.05em; margin-bottom: 0.34rem; text-transform: uppercase; }
.system-world__section ul { display: grid; gap: 0.28rem; list-style: none; margin: 0.45rem 0 0; padding: 0; }
.system-world__section li { background: rgba(92, 133, 191, 0.08); border-radius: 0.45rem; display: grid; gap: 0.08rem; padding: 0.42rem 0.5rem; }
.system-world__section li strong { font-size: 0.64rem; }
.system-world__section li span { color: rgba(208, 222, 244, 0.56); font-size: 0.58rem; }
.system-world__large-file-warning { background: rgba(255, 91, 35, 0.13); border-left: 2px solid var(--city-orange); color: #ffc2ab !important; padding: 0.55rem 0.65rem; }

.system-world__connection-focus {
  background: linear-gradient(145deg, rgba(83, 220, 255, 0.11), rgba(255, 224, 138, 0.06));
  border: 1px solid rgba(103, 223, 255, 0.28);
  border-radius: 0.72rem;
  margin: 0.72rem 0;
  padding: 0.65rem;
}
.system-world__connection-focus h3 { font-size: 0.73rem; line-height: 1.42; margin: 0.24rem 0; }
.system-world__connection-focus h3 code { color: #ffe08a; overflow-wrap: anywhere; }
.system-world__connection-focus > p { font-size: 0.61rem; margin: 0.34rem 0; }
.system-world__connection-providers { display: grid; gap: 0.18rem; margin: 0.5rem 0; }
.system-world__connection-providers strong,
.system-world__connection-last-mile summary { color: rgba(225, 239, 255, 0.74); font-size: 0.54rem; letter-spacing: 0.05em; text-transform: uppercase; }
.system-world__connection-providers code { color: rgba(211, 228, 250, 0.68); font-size: 0.52rem; overflow-wrap: anywhere; }
.system-world__connection-last-mile { border-top: 1px solid rgba(123, 190, 225, 0.17); margin-top: 0.5rem; padding-top: 0.45rem; }
.system-world__connection-last-mile summary { cursor: pointer; margin-bottom: 0.28rem; }
.system-world__connection-last-mile > button {
  background: rgba(8, 17, 31, 0.38);
  border: 1px solid transparent;
  border-radius: 0.38rem;
  color: rgba(228, 238, 253, 0.8);
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 0.06rem;
  margin-top: 0.18rem;
  padding: 0.34rem 0.4rem;
  text-align: left;
  width: 100%;
}
.system-world__connection-last-mile > button:hover,
.system-world__connection-last-mile > button.system-world__connection-file--active { background: rgba(83, 220, 255, 0.15); border-color: rgba(103, 223, 255, 0.3); }
.system-world__connection-last-mile button strong { font-size: 0.59rem; }
.system-world__connection-last-mile button span { color: rgba(206, 221, 244, 0.52); font-size: 0.48rem; overflow-wrap: anywhere; }
.system-world__connection-file-detail { background: rgba(4, 10, 21, 0.58); border-left: 2px solid #ffe08a; display: grid; gap: 0.26rem; margin-top: 0.5rem; padding: 0.5rem; }
.system-world__connection-file-detail h4 { font-size: 0.68rem; margin: 0; }
.system-world__connection-file-detail > code { color: rgba(210, 226, 249, 0.68); font-size: 0.52rem; overflow-wrap: anywhere; }
.system-world__connection-file-detail > p { font-size: 0.58rem; margin: 0; }
.system-world__connection-file-detail > span { color: rgba(255, 224, 138, 0.72); font-size: 0.52rem; text-transform: uppercase; }
.system-world__connection-file-detail .v-btn { justify-self: start; }

.system-world__largest-file { background: linear-gradient(90deg, rgba(255, 105, 48, 0.12), rgba(117, 97, 255, 0.08)); border: 1px solid rgba(255, 129, 77, 0.18); border-radius: 0.65rem; color: #fff; cursor: pointer; display: grid; font: inherit; margin-top: 0.65rem; padding: 0.55rem 0.65rem; text-align: left; width: 100%; }
.system-world__largest-file > span { color: #ffab88; font-size: 0.54rem; text-transform: uppercase; }
.system-world__largest-file strong { font-size: 0.68rem; margin-top: 0.12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.system-world__largest-file small { color: rgba(222, 231, 247, 0.5); font-size: 0.56rem; }

.system-world__relationships { display: grid; gap: 0.24rem; }
.system-world__relationship { background: rgba(89, 127, 184, 0.06); border-radius: 0.42rem; overflow: hidden; }
.system-world__relationships button { align-items: center; background: rgba(89, 127, 184, 0.08); border: 0; border-radius: 0.42rem; color: rgba(225, 236, 253, 0.82); cursor: pointer; display: grid; font: inherit; gap: 0.36rem; grid-template-columns: 4.4rem 1fr; padding: 0.36rem 0.44rem; text-align: left; }
.system-world__relationship > button { width: 100%; }
.system-world__relationships button:hover { background: rgba(91, 177, 228, 0.14); }
.system-world__relationships span { color: rgba(105, 218, 255, 0.62); font-size: 0.52rem; text-transform: uppercase; }
.system-world__relationships strong { font-size: 0.61rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.system-world__boundary-summary { border-top: 1px solid rgba(120, 171, 230, 0.1); display: grid; gap: 0.3rem; padding: 0.42rem 0.5rem; }
.system-world__boundary-summary > strong { color: rgba(226, 239, 255, 0.74); font-size: 0.54rem; letter-spacing: 0.04em; text-transform: uppercase; }
.system-world__boundary-summary p { color: rgba(224, 236, 253, 0.76); font-size: 0.56rem; margin: 0; overflow-wrap: anywhere; }
.system-world__boundary-summary p span { color: rgba(105, 218, 255, 0.62); display: block; font-size: 0.49rem; margin-bottom: 0.08rem; text-transform: uppercase; }
.system-world__connection-files { border-top: 1px solid rgba(120, 171, 230, 0.1); padding: 0.2rem 0.32rem 0.32rem; }
.system-world__connection-files details { border-radius: 0.34rem; color: rgba(225, 236, 253, 0.78); }
.system-world__connection-files details[open] { background: rgba(8, 17, 31, 0.42); }
.system-world__connection-files summary { cursor: pointer; display: grid; gap: 0.06rem; padding: 0.3rem 0.38rem; }
.system-world__connection-files summary::marker { color: rgba(105, 218, 255, 0.72); }
.system-world__connection-files summary strong { font-size: 0.59rem; }
.system-world__connection-files summary span { font-size: 0.48rem; text-transform: none; }
.system-world__connection-detail { display: grid; gap: 0.24rem; padding: 0 0.4rem 0.42rem; }
.system-world__connection-detail code { color: rgba(204, 221, 247, 0.68); font-size: 0.52rem; overflow-wrap: anywhere; }
.system-world__connection-detail > span { font-size: 0.52rem; }
.system-world__connection-detail p { font-size: 0.55rem; margin: 0.12rem 0 0; }
.system-world__connection-detail p strong { color: rgba(236, 246, 255, 0.9); font-size: inherit; white-space: normal; }
.system-world__declared-only { font-size: 0.53rem !important; margin: 0 !important; padding: 0.18rem 0.46rem 0.4rem; }

.system-world__controls-hint,
.system-world__legend {
  align-items: center;
  backdrop-filter: blur(12px);
  background: rgba(5, 9, 20, 0.78);
  border: 1px solid rgba(126, 158, 211, 0.13);
  border-radius: 999px;
  bottom: 0.55rem;
  display: flex;
  font-size: 0.55rem;
  gap: 0.68rem;
  padding: 0.35rem 0.65rem;
  position: absolute;
  z-index: 7;
}
.system-world__controls-hint { left: 0.7rem; }
.system-world__controls-hint span { align-items: center; color: rgba(216, 229, 248, 0.66); display: flex; gap: 0.25rem; white-space: nowrap; }
.system-world__legend { right: 0.7rem; }
.system-world__legend span { align-items: center; display: flex; gap: 0.25rem; white-space: nowrap; }
.system-world__legend i { display: inline-block; height: 0.48rem; width: 0.48rem; }
.system-world__legend-campus { background: #183856; border: 1px solid #75dfff; }
.system-world__legend-depth { background: linear-gradient(135deg, #28455e 50%, #62bde8 50%); border-bottom: 2px solid #91e3ff; }
.system-world__legend-building { background: #6b8be8; }
.system-world__legend-cloud { background: #55cde5; border: 1px solid #d9fbff; border-radius: 50%; }
.system-world__legend-owned { background: #75f3ff; height: 0.12rem !important; width: 0.7rem !important; }
.system-world__legend-import { background: #59e3ff; height: 0.12rem !important; width: 0.7rem !important; }
.system-world__legend-injection { background: #c69cff; height: 0.12rem !important; width: 0.7rem !important; }
.system-world__legend-bundle { background: linear-gradient(90deg, #aeb6c0, #252a31); height: 0.1rem !important; width: 0.8rem !important; }
.system-world__legend-last-mile { background: #ffe08a; height: 0.12rem !important; width: 0.7rem !important; }
.system-world__legend-declaration { background: repeating-linear-gradient(90deg, #ffc86b 0 0.18rem, transparent 0.18rem 0.28rem); height: 0.12rem !important; width: 0.8rem !important; }
.system-world__legend-external { background: #c69cff; transform: rotate(45deg) scale(0.72); }
.system-world__legend-evidence { background: linear-gradient(90deg, #59e3ff 0 50%, #c69cff 50%); height: 0.08rem !important; width: 0.8rem !important; }
.system-world__legend-library-evidence { background: #c69cff; height: 0.08rem !important; width: 0.8rem !important; }

@media (max-width: 1120px) {
  .system-world__toolbar { grid-template-columns: 1fr auto; }
  .system-world__mode-switch { grid-column: 1 / -1; grid-row: 2; justify-self: center; }
  .system-world__legend { display: none; }
}

@media (max-width: 760px) {
  .system-world__mode-switch > span { display: none; }
  .system-world__inspector { width: min(20rem, 52%); }
  .system-world__navigator { display: none; }
  .system-world__controls-hint span:last-child { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .system-world__progress-pulse,
  .system-world__state-orbit { animation: none; }
}
</style>
