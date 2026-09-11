/* Separately linked test archive. No symbol here is referenced by production. */
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/stat.h>

#include "acl.h"

enum test_scenario {
    NO_ACL = 0, EMPTY_ACL, ONE_ACE, INIT_FAILURE, STAT_FAILURE,
    STAT_UNSUPPORTED, STAT_FALSE_SUCCESS, OWNER_ABSENT, GROUP_ABSENT,
    MODE_ABSENT, OWNER_MISMATCH, GROUP_MISMATCH, MODE_MISMATCH,
    OWNER_READ_FAILURE, ACL_QUERY_FAILURE, ACL_READ_FAILURE,
    NULL_ACL, SENTINEL_ACL, INVALID_ACL, ITERATOR_FAILURE,
    ITERATOR_UNEXPECTED, NULL_ENTRY, STAT_UNEXPECTED, ACL_READ_UNEXPECTED,
    QUERY_UNEXPECTED, ITERATOR_UNSUPPORTED, STALE_ERRNO_SUCCESS,
    METADATA_QUERY_FAILURE, STAT_ENOENT, ACL_READ_ENOENT,
    GROUP_READ_FAILURE, MODE_READ_FAILURE, ACL_FREE_FAILURE,
    QUERY_UNSUPPORTED, ACL_READ_UNSUPPORTED, VALIDATE_UNSUPPORTED
};

static _Thread_local struct {
    int scenario;
    unsigned int security_frees;
    unsigned int acl_frees;
    unsigned int bad_call;
    int populated;
    int validated;
    uint64_t security_tag;
    uint64_t acl_tag;
    uint64_t entry_tag;
} fixture;

static filesec_t fake_filesec_init(void) {
    if (fixture.scenario == INIT_FAILURE) {
        errno = ENOMEM;
        return NULL;
    }
    return (filesec_t)&fixture.security_tag;
}

static void check_security(filesec_t security) {
    if (security != (filesec_t)&fixture.security_tag) fixture.bad_call = 1;
}

static int fake_fstatx_np(int fd, struct stat *status, filesec_t security) {
    check_security(security);
    if (fd != 77) fixture.bad_call = 1;
    if (fixture.scenario == STAT_FAILURE || fixture.scenario == STAT_UNSUPPORTED
        || fixture.scenario == STAT_ENOENT) {
        errno = fixture.scenario == STAT_UNSUPPORTED ? ENOTSUP
            : fixture.scenario == STAT_ENOENT ? ENOENT : EACCES;
        return -1;
    }
    if (fixture.scenario == STAT_UNEXPECTED) {
        errno = EIO;
        return 1;
    }
    status->st_uid = 501;
    status->st_gid = 20;
    status->st_mode = S_IFREG | 0600;
    if (fixture.scenario == STAT_FALSE_SUCCESS) {
        errno = ENOMEM;
        return 0;
    }
    fixture.populated = 1;
    return 0;
}

static int fake_filesec_query_property(filesec_t security, filesec_property_t property, int *present) {
    check_security(security);
    if (fixture.scenario == METADATA_QUERY_FAILURE && property == FILESEC_OWNER) {
        errno = EIO;
        return -1;
    }
    if (property == FILESEC_ACL) {
        if (fixture.scenario == ACL_QUERY_FAILURE || fixture.scenario == QUERY_UNSUPPORTED) {
            errno = fixture.scenario == QUERY_UNSUPPORTED ? EOPNOTSUPP : EACCES;
            return -1;
        }
        if (fixture.scenario == QUERY_UNEXPECTED) {
            errno = EIO;
            return 1;
        }
        *present = fixture.scenario == NO_ACL ? 0 : 32;
        return 0;
    }
    *present = fixture.populated ? 16 : 0;
    if ((fixture.scenario == OWNER_ABSENT && property == FILESEC_OWNER)
        || (fixture.scenario == GROUP_ABSENT && property == FILESEC_GROUP)
        || (fixture.scenario == MODE_ABSENT && property == FILESEC_MODE)) *present = 0;
    return 0;
}

static int fake_filesec_get_property(filesec_t security, filesec_property_t property, void *output) {
    check_security(security);
    if ((fixture.scenario == OWNER_READ_FAILURE && property == FILESEC_OWNER)
        || (fixture.scenario == GROUP_READ_FAILURE && property == FILESEC_GROUP)
        || (fixture.scenario == MODE_READ_FAILURE && property == FILESEC_MODE)) {
        errno = EACCES;
        return -1;
    }
    switch (property) {
        case FILESEC_OWNER:
            *(uid_t *)output = fixture.scenario == OWNER_MISMATCH ? 502 : 501;
            return 0;
        case FILESEC_GROUP:
            *(gid_t *)output = fixture.scenario == GROUP_MISMATCH ? 21 : 20;
            return 0;
        case FILESEC_MODE:
            *(mode_t *)output = fixture.scenario == MODE_MISMATCH ? S_IFREG | 0644 : S_IFREG | 0600;
            return 0;
        case FILESEC_ACL:
            if (fixture.scenario == ACL_READ_FAILURE || fixture.scenario == ACL_READ_ENOENT
                || fixture.scenario == ACL_READ_UNSUPPORTED) {
                errno = fixture.scenario == ACL_READ_ENOENT ? ENOENT
                    : fixture.scenario == ACL_READ_UNSUPPORTED ? ENOTSUP : EACCES;
                return -1;
            }
            if (fixture.scenario == ACL_READ_UNEXPECTED) {
                errno = EIO;
                return 1;
            }
            *(acl_t *)output = fixture.scenario == NULL_ACL ? NULL
                : fixture.scenario == SENTINEL_ACL ? (acl_t)_FILESEC_REMOVE_ACL
                : (acl_t)&fixture.acl_tag;
            return 0;
        default:
            fixture.bad_call = 1;
            errno = EINVAL;
            return -1;
    }
}

static int fake_acl_valid(acl_t acl) {
    if (acl != (acl_t)&fixture.acl_tag) fixture.bad_call = 1;
    if (fixture.scenario == INVALID_ACL || fixture.scenario == VALIDATE_UNSUPPORTED) {
        errno = fixture.scenario == INVALID_ACL ? EINVAL : ENOTSUP;
        return -1;
    }
    fixture.validated = 1;
    return 0;
}

static int fake_acl_get_entry(acl_t acl, int index, acl_entry_t *entry) {
    if (acl != (acl_t)&fixture.acl_tag || index != ACL_FIRST_ENTRY || !fixture.validated)
        fixture.bad_call = 1;
    if (fixture.scenario == EMPTY_ACL) {
        errno = EINVAL;
        return -1;
    }
    if (fixture.scenario == ITERATOR_FAILURE || fixture.scenario == ITERATOR_UNSUPPORTED) {
        errno = fixture.scenario == ITERATOR_UNSUPPORTED ? ENOTSUP : ENOMEM;
        return -1;
    }
    if (fixture.scenario == ITERATOR_UNEXPECTED) {
        errno = EINVAL;
        return 1;
    }
    *entry = fixture.scenario == NULL_ENTRY ? NULL : (acl_entry_t)&fixture.entry_tag;
    if (fixture.scenario == STALE_ERRNO_SUCCESS) errno = EINVAL;
    return 0;
}

static int fake_acl_free(void *object) {
    fixture.acl_frees += 1;
    if (object != &fixture.acl_tag) fixture.bad_call = 1;
    errno = EINVAL;
    return fixture.scenario == ACL_FREE_FAILURE ? -1 : 0;
}

static void fake_filesec_free(filesec_t security) {
    check_security(security);
    fixture.security_frees += 1;
    errno = EINVAL;
}

static int fake_check_fd(int fd);
#define aicharts_macos_check_acl_fd fake_check_fd
#define filesec_init fake_filesec_init
#define fstatx_np fake_fstatx_np
#define filesec_query_property fake_filesec_query_property
#define filesec_get_property fake_filesec_get_property
#define acl_valid fake_acl_valid
#define acl_get_entry fake_acl_get_entry
#define acl_free fake_acl_free
#define filesec_free fake_filesec_free
#include "acl.c"
#undef aicharts_macos_check_acl_fd
#undef filesec_init
#undef fstatx_np
#undef filesec_query_property
#undef filesec_get_property
#undef acl_valid
#undef acl_get_entry
#undef acl_free
#undef filesec_free

/* Return status and cleanup counters; never return native errors or pointers. */
uint32_t aicharts_macos_acl_test_run(int scenario) {
    memset(&fixture, 0, sizeof(fixture));
    if (scenario < NO_ACL || scenario > VALIDATE_UNSUPPORTED) return 0xff000002;
    fixture.scenario = scenario;
    const unsigned int result = (unsigned int)fake_check_fd(77);
    return (result & 255) | (fixture.security_frees << 8)
        | (fixture.acl_frees << 16) | (fixture.bad_call << 24);
}

/* Only cfg(test) Rust can link this helper. Its caller owns the disposable fd. */
int aicharts_macos_acl_test_set(int fd, int kind) {
    if (kind < 0 || kind > 3) return 1;
    acl_t acl = acl_init(1);
    acl_entry_t entry = NULL;
    acl_permset_t permissions = NULL;
    acl_flagset_t flags = NULL;
    int result = 1;
    /* A synthetic opaque principal, with no account or directory lookup. */
    const unsigned char principal[16] = {
        0x41, 0x49, 0x43, 0x48, 0x41, 0x52, 0x44, 0x11,
        0x81, 0x91, 0x51, 0x61, 0x71, 0x81, 0x91, 0x01
    };
    if (acl == NULL) return 1;
    if (kind != 0) {
        if (acl_create_entry(&acl, &entry) != 0
            || acl_set_tag_type(entry, kind == 2 ? ACL_EXTENDED_DENY : ACL_EXTENDED_ALLOW) != 0
            || acl_set_qualifier(entry, principal) != 0
            || acl_get_permset(entry, &permissions) != 0
            || acl_clear_perms(permissions) != 0
            || acl_add_perm(permissions, ACL_READ_DATA) != 0
            || acl_set_permset(entry, permissions) != 0) goto done;
        if (kind == 3) {
            if (acl_get_flagset_np(entry, &flags) != 0
                || acl_add_flag_np(flags, ACL_ENTRY_FILE_INHERIT) != 0
                || acl_add_flag_np(flags, ACL_ENTRY_DIRECTORY_INHERIT) != 0
                || acl_add_flag_np(flags, ACL_ENTRY_ONLY_INHERIT) != 0
                || acl_set_flagset_np(entry, flags) != 0) goto done;
        }
    }
    if (acl_set_fd_np(fd, acl, ACL_TYPE_EXTENDED) == 0) result = 0;
done:
    if (acl_free(acl) != 0) result = 1;
    return result;
}
