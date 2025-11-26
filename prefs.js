import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ResticBackupPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Service'});

        const row = new Adw.ActionRow({
            title: 'Backup name',
            subtitle: 'Used to build restic-backups-{name}.service',
        });

        const entry = new Gtk.Entry({
            text: settings.get_string('service-name'),
            placeholder_text: 'home',
            hexpand: true,
        });

        settings.bind('service-name', entry, 'text', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(entry);
        row.set_activatable_widget(entry);

        group.add(row);
        page.add(group);
        window.add(page);
    }
}
