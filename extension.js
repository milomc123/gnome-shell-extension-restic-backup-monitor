/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const BackupIndicator = GObject.registerClass(
class BackupIndicator extends SystemIndicator {
    constructor(settings) {
        super();

        this._settings = settings;
        this._backupInProgress = false;

        this._indicator = this._addIndicator();
        this._indicator.iconName = 'emblem-synchronizing-symbolic';
        this._indicator.visible = false;

        this.quickSettingsItems = [];

        this._settingsChangedId = this._settings?.connect('changed::service-name',
            () => this._restartMonitor());

        this._hideTimeoutId = null;
        this._subprocess = null;
        this._stdoutStream = null;

        this._restartMonitor();
    }

    _getServiceName() {
        const name = this._settings?.get_string('service-name')?.trim();
        const defaultName = GLib.get_host_name() || 'home';
        return name || defaultName;
    }

    _getServiceUnit() {
        const serviceName = this._getServiceName();

        if (serviceName.endsWith('.service'))
            return serviceName;

        return `restic-backups-${serviceName}.service`;
    }

    _restartMonitor() {
        this._stopMonitor();
        this._backupInProgress = false;

        const unit = this._getServiceUnit();
        const argv = ['journalctl', '-f', '-u', unit, '-n0', '-o', 'cat'];

        try {
            this._subprocess = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            logError(e, 'Failed to start journalctl monitor');
            return;
        }

        const stdoutPipe = this._subprocess.get_stdout_pipe();
        if (!stdoutPipe) {
            this._stopMonitor();
            return;
        }

        this._stdoutStream = new Gio.DataInputStream({base_stream: stdoutPipe});
        this._readNextLine();
    }

    _readNextLine() {
        if (!this._stdoutStream)
            return;

        this._stdoutStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            let line;
            try {
                [line] = stream.read_line_finish_utf8(res);
            } catch (e) {
                logError(e, 'Failed reading journalctl output');
                this._indicator.visible = false;
                return;
            }

            if (line === null) {
                this._indicator.visible = false;
                return;
            }

            this._handleLogLine(line);
            this._readNextLine();
        });
    }

    _handleLogLine(rawLine) {
        const line = rawLine.trim();
        if (!line)
            return;

        let obj = null;
        if (line.startsWith('{')) {
            try {
                obj = JSON.parse(line);
            } catch (e) {
                // Ignore non-JSON lines.
            }
        }

        if (obj?.message_type === 'status') {
            this._showIndicator();
            if (!this._backupInProgress) {
                this._backupInProgress = true;
                Main.notify('Restic backup started', `Service ${this._getServiceName()}`);
            }
            return;
        }

        if (obj?.message_type === 'summary' || line.includes('Succeeded.')) {
            if (this._backupInProgress) {
                this._backupInProgress = false;
                Main.notify('Restic backup finished', `Service ${this._getServiceName()}`);
            }
            this._markComplete();
        }
    }

    _showIndicator() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }
        this._indicator.visible = true;
    }

    _markComplete() {
        this._showIndicator();
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._indicator.visible = false;
            this._hideTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopMonitor() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }

        if (this._stdoutStream) {
            try {
                this._stdoutStream.close(null);
            } catch (e) {
                // Ignore close errors.
            }
            this._stdoutStream = null;
        }

        if (this._subprocess) {
            try {
                this._subprocess.force_exit();
            } catch (e) {
                // Ignore exit errors.
            }
            this._subprocess = null;
        }

        this._backupInProgress = false;
        this._indicator.visible = false;
    }

    destroy() {
        this._stopMonitor();

        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        super.destroy();
    }
});

export default class QuickSettingsExampleExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._indicator = new BackupIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }
}
