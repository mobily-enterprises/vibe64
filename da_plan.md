 1. Preserve Current Metal Baseline
      - Keep metal host as the only public ingress point.
      - Keep Caddy + vibe64-edge-router on metal.
      - Keep / on compressed ZFS and host zram active.
      - Do not put tenant state directly on metal.

  2. Install And Initialize Incus
      - Use Incus, not LXD snap, for tenant VMs.
      - Ensure Incus is installed from apt.
      - Initialize Incus with a ZFS storage pool backed by rpool/incus.
      - Ensure Incus network/profile exists for Vibe64 tenant VMs.
      - Apply default VM limits:
          - CPU: 2
          - RAM: 4GiB
          - disk: 10GiB
          - guest zram: 50%, lz4

  3. Create Shared Metal Runtime Layout
      - Metal owns the Vibe64 release:
          - /opt/vibe64/current
          - /opt/vibe64/releases/...

      - Metal owns Nix package runtime:
          - /nix/store
          - /opt/vibe64/runtime-packs

      - Tenant VMs mount these read-only:
          - /opt/vibe64
          - /nix/store
          - /opt/vibe64/runtime-packs

  4. Build Runtime Packs
      - Create a runtime-pack manifest under:
          - /opt/vibe64/runtime-packs/manifest.json

      - Metal realizes and GC-roots approved Nix closures:
          - Node 22
          - Node 20 if needed
          - Git
          - ripgrep
          - bubblewrap
          - PHP/Laravel runtime when ready
          - Composer
          - MariaDB server/client runtime, matching the supported Vibe64 runtime version
          - Playwright
          - Playwright browser dependencies/fonts

      - Expose stable wrappers:
          - /opt/vibe64/runtime-packs/node22/bin/node
          - /opt/vibe64/runtime-packs/node22/bin/npm
          - /opt/vibe64/runtime-packs/php84/bin/php
          - /opt/vibe64/runtime-packs/composer/bin/composer
          - /opt/vibe64/runtime-packs/mariadb/bin/mariadb
          - /opt/vibe64/runtime-packs/mariadb/bin/mariadb-dump
          - /opt/vibe64/runtime-packs/playwright/bin/playwright

      - Install host-wide operator CLIs on the metal host:
          - Codex
          - OpenCode

      - Keep Codex/OpenCode installation metal-owned, not tenant-VM-local, unless a later security review says a tenant-local install is required.

  5. Create VM Factory Script
      - Add:
          - tooling/metal/create-vibe64-tenant-vps.sh

      - Required command shape:

        create-vibe64-tenant-vps <tenant> --admin-user <user>

      - For pilot:

        create-vibe64-tenant-vps mercmobily --admin-user merc --cpu 2 --memory 4GiB --disk 10GiB

      - Validate tenant separately from admin user:
          - tenant: DNS-safe, lowercase, starts with letter, letters/digits/hyphens only
          - admin user: normal Linux username validation

      - Create VM:
          - name: v64-<tenant>
          - workspace: <tenant>
          - admin user: <admin-user>
          - daemon user inside VM: v64d_<tenant>

  6. Configure Tenant VM
      - Mount read-only from metal:
          - /opt/vibe64
          - /nix/store

      - Keep local writable state:
          - /home/<admin-user>
          - /home/v64d_<tenant>
          - /var/lib/vibe64/<tenant>
          - /var/cache/vibe64
          - DB/runtime state

      - Install guest prerequisites:
          - systemd basics
          - zram with lz4
          - sudo/ssh/admin tools as needed

      - Do not install separate Vibe64 copies inside the VM.
      - Do not run arbitrary tenant Nix installs as the source of platform packages.

  7. Bootstrap Vibe64 Inside VM
      - Inside VM, run:

        /opt/vibe64/current/tooling/host/setup-vibe64-vps.sh \
          <tenant> <admin-user> \
          --domain vibe64.dev \
          --user-domain users.vibe64.dev \
          --preview-domain vibe64.dev \
          --deployment-domain hosting.vibe64.dev

      - Confirm:
          - vibe64@<tenant>.service active
          - service listens on 0.0.0.0:3000
          - /opt/vibe64 is read-only
          - /nix/store is read-only
          - zram active inside guest

  8. Register Metal Edge Route
      - Discover VM IP.
      - Register tenant upstream:

        sudo vibe64-edge tenant upsert <tenant> --upstream http://<vm-ip>:3000

      - For pilot:

        sudo vibe64-edge tenant upsert mercmobily --upstream http://<vm-ip>:3000

      - Smoke:

        curl -H 'Host: mercmobily.users.vibe64.dev' http://127.0.0.1/
        curl http://mercmobily.users.vibe64.dev/

  9. Create Migration Script
      - Add:
          - tooling/metal/migrate-old-vps-tenant.sh

      - Required pilot command:

        migrate-old-vps-tenant.sh \
          --old-host root@old_vps \
          --tenant mercmobily \
          --admin-user merc \
          --confirm-tenant mercmobily

      - Must keep tenant and admin user distinct:
          - old tenant/workspace: mercmobily
          - old human user: mercmobily
          - new tenant/workspace: mercmobily
          - new human user: merc

      - Stop only old vibe64@mercmobily.service during the migration window.
      - Leave all old data intact.

  10. Migrate Pilot Data

  - Before moving or copying MariaDB volume data, create a logical database dump first:
      - dump from the old tenant MariaDB runtime/container
      - store it under a timestamped migration directory
      - verify the dump file exists and is non-empty before proceeding
      - keep the raw old MariaDB volume untouched as a fallback

  - Copy from old host:
      - /home/v64d_mercmobily
      - /var/lib/vibe64/mercmobily/projects
      - /var/lib/vibe64/mercmobily/services
      - MariaDB volume vibe64_mercmobily_mariadb_data

  - Carefully handle old human home:
      - old /home/mercmobily maps to new /home/merc only where explicitly intended

  - Call out credentials:
      - old /home/mercmobily/.config/gh
      - old /home/v64d_mercmobily/.codex/auth.json

  - Because this is beta, copying may be acceptable, but it must be explicit.

  11. Restart And Smoke Pilot

  - Start/restart:

    incus exec v64-mercmobily -- systemctl restart vibe64@mercmobily

  - Verify:
      - service active
      - Studio loads
      - login/admin user merc works
      - project list shows migrated projects
      - testing project state exists
      - DB-backed project/runtime state works
      - public route works:
          - mercmobily.users.vibe64.dev

  12. Update/Rollback Model

  - Vibe64 update:
      - install new release once on metal
      - repoint /opt/vibe64/current
      - restart tenant services across VMs

  - Runtime pack update:
      - realize new Nix closures on metal
      - update /opt/vibe64/runtime-packs
      - keep old pack closures GC-rooted while any tenant still needs them

  - Rollback:
      - repoint /opt/vibe64/current
      - repoint runtime pack manifest if needed
      - restart affected tenant services

  13. Do Not Delete Old Tenant Yet

  - Keep old VPS data unchanged after pilot migration.
  - Do not remove vibe64@mercmobily data from old host.
  - Only after extended validation, decide whether to disable old service permanently.
