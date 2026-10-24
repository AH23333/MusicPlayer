//go:build darwin

#import <Cocoa/Cocoa.h>
#include <string.h>

void music_dl_install_edit_menu(void) {
    NSMenu *bar = [NSApp mainMenu];
    if (!bar) {
        bar = [[NSMenu alloc] initWithTitle:@""];
        [NSApp setMainMenu:bar];
    }
    // A pre-existing menu bar does not imply that it contains an application
    // menu or a Quit item. Always ensure Command-Q has an explicit target.
    NSMenu *appMenu = bar.numberOfItems ? [[bar itemAtIndex:0] submenu] : nil;
    if (!appMenu || [appMenu.title isEqualToString:@"编辑"]) {
        NSMenuItem *appItem = [[NSMenuItem alloc] initWithTitle:@"music-dl" action:nil keyEquivalent:@""];
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
    if (!quit) quit = [appMenu addItemWithTitle:@"退出 music-dl" action:@selector(terminate:) keyEquivalent:@"q"];
    [quit setTarget:NSApp];
    [quit setKeyEquivalent:@"q"];
    [quit setKeyEquivalentModifierMask:NSEventModifierFlagCommand];
    if ([bar itemWithTitle:@"编辑"]) return;
    NSMenu *edit = [[NSMenu alloc] initWithTitle:@"编辑"];
    [edit addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
    NSMenuItem *redo = [edit addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"z"];
    [redo setKeyEquivalentModifierMask:NSEventModifierFlagCommand | NSEventModifierFlagShift];
    [edit addItem:[NSMenuItem separatorItem]];
    [edit addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [edit addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [edit addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [edit addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"编辑" action:nil keyEquivalent:@""];
    [item setSubmenu:edit];
    [bar addItem:item];
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
        if ([panel runModal] != NSModalResponseOK) return NULL;
        return strdup([[[panel URL] path] UTF8String]);
    }
}
