#import <Cocoa/Cocoa.h>
#include <stdlib.h>
#include <string.h>

void music_dl_install_native_menu(void) {
    @autoreleasepool {
        NSMenu *bar = [NSApp mainMenu];
        if (!bar) {
            bar = [[NSMenu alloc] initWithTitle:@""];
            [NSApp setMainMenu:bar];
        }

        // A pre-existing menu bar does not imply that it has an application
        // menu. Keep Command-Q available even when AppKit supplies another menu.
        NSMenu *appMenu = bar.numberOfItems ? [[bar itemAtIndex:0] submenu] : nil;
        if (!appMenu || [appMenu.title isEqualToString:@"编辑"]) {
            NSMenuItem *appItem =
                [[NSMenuItem alloc] initWithTitle:@"music-dl" action:nil keyEquivalent:@""];
            appMenu = [[NSMenu alloc] initWithTitle:@"music-dl"];
            [appItem setSubmenu:appMenu];
            [bar insertItem:appItem atIndex:0];
        }

        NSMenuItem *quit = nil;
        for (NSMenuItem *item in appMenu.itemArray) {
            if (item.action == @selector(terminate:)) {
                quit = item;
                break;
            }
        }
        if (!quit) {
            quit = [appMenu addItemWithTitle:@"退出 music-dl"
                                      action:@selector(terminate:)
                               keyEquivalent:@"q"];
        }
        [quit setTarget:NSApp];
        [quit setKeyEquivalent:@"q"];
        [quit setKeyEquivalentModifierMask:NSEventModifierFlagCommand];
        [quit setEnabled:YES];
        [quit setHidden:NO];

        if ([bar itemWithTitle:@"编辑"]) {
            return;
        }

        NSMenu *edit = [[NSMenu alloc] initWithTitle:@"编辑"];
        [edit addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
        NSMenuItem *redo =
            [edit addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"z"];
        [redo setKeyEquivalentModifierMask:NSEventModifierFlagCommand |
                                          NSEventModifierFlagShift];
        [edit addItem:[NSMenuItem separatorItem]];
        [edit addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
        [edit addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
        [edit addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
        [edit addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];

        NSMenuItem *editItem =
            [[NSMenuItem alloc] initWithTitle:@"编辑" action:nil keyEquivalent:@""];
        [editItem setSubmenu:edit];
        [bar addItem:editItem];
    }
}

char *music_dl_pick_folder(void) {
    @autoreleasepool {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        [panel setTitle:@"选择下载目录"];
        [panel setPrompt:@"选择目录"];
        [panel setCanChooseFiles:NO];
        [panel setCanChooseDirectories:YES];
        [panel setAllowsMultipleSelection:NO];
        [panel setCanCreateDirectories:YES];
        if ([panel runModal] != NSModalResponseOK) {
            return NULL;
        }

        NSString *path = [[panel URL] path];
        const char *utf8 = [path UTF8String];
        return utf8 ? strdup(utf8) : NULL;
    }
}

void music_dl_free_string(char *value) {
    free(value);
}
