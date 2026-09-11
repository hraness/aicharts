#ifndef AICHARTS_PLATFORM_ACL_H
#define AICHARTS_PLATFORM_ACL_H

/* Closed result ABI; no native structures or pointers cross into Rust. */
#define AICHARTS_ACL_CLEAR 0
#define AICHARTS_ACL_PRESENT 1
#define AICHARTS_ACL_UNAVAILABLE 2
#define AICHARTS_ACL_UNSUPPORTED 3

int aicharts_macos_check_acl_fd(int fd);

#endif
