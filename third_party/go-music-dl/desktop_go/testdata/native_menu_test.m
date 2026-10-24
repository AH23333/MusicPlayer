#import <Cocoa/Cocoa.h>
#include <stdio.h>
void music_dl_install_edit_menu(void);

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        // AppKit can provide an existing menu bar with no application submenu.
        [NSApp setMainMenu:[[NSMenu alloc] initWithTitle:@""]];
        music_dl_install_edit_menu();
        NSMenu *appMenu = [[[NSApp mainMenu] itemAtIndex:0] submenu];
        NSMenuItem *quit = nil;
        for (NSMenuItem *item in appMenu.itemArray) {
            if (item.action == @selector(terminate:)) quit = item;
        }
        if (!quit || ![quit.keyEquivalent isEqualToString:@"q"] ||
            quit.keyEquivalentModifierMask != NSEventModifierFlagCommand || quit.target != NSApp) {
            fprintf(stderr, "FAIL: existing menu bar has no working Command-Q quit item\n");
            return 1;
        }
        NSInteger count = NSApp.mainMenu.numberOfItems;
        music_dl_install_edit_menu();
        if (NSApp.mainMenu.numberOfItems != count) {
            fprintf(stderr, "FAIL: installing native menus twice duplicates menu items\n");
            return 1;
        }
        puts("PASS: Command-Q has an explicit application target; menu setup is idempotent");
    }
    return 0;
}
