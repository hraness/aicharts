#include "acl.h"

#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <sys/acl.h>
#include <sys/stat.h>

static int native_failure(int error) {
    return error == ENOTSUP || error == EOPNOTSUPP
        ? AICHARTS_ACL_UNSUPPORTED : AICHARTS_ACL_UNAVAILABLE;
}

static int complete_stat_properties(filesec_t security, const struct stat *status) {
    const filesec_property_t properties[] = {FILESEC_OWNER, FILESEC_GROUP, FILESEC_MODE};
    uid_t owner = 0;
    gid_t group = 0;
    mode_t mode = 0;
    for (size_t index = 0; index < sizeof(properties) / sizeof(properties[0]); ++index) {
        int present = 0;
        if (filesec_query_property(security, properties[index], &present) != 0)
            return native_failure(errno);
        if (present == 0) return AICHARTS_ACL_UNAVAILABLE;
    }
    if (filesec_get_property(security, FILESEC_OWNER, &owner) != 0)
        return native_failure(errno);
    if (filesec_get_property(security, FILESEC_GROUP, &group) != 0)
        return native_failure(errno);
    if (filesec_get_property(security, FILESEC_MODE, &mode) != 0)
        return native_failure(errno);
    return owner == status->st_uid && group == status->st_gid && mode == status->st_mode
        ? AICHARTS_ACL_CLEAR : AICHARTS_ACL_UNAVAILABLE;
}

static int check_acl_fd(int fd, int deny_only) {
    struct stat status = {0};
    filesec_t security = filesec_init();
    acl_t acl = NULL;
    acl_entry_t entry = NULL;
    int present = 0;
    int result = AICHARTS_ACL_UNAVAILABLE;
    if (security == NULL) return native_failure(errno);
    if (fstatx_np(fd, &status, security) != 0) {
        result = native_failure(errno);
        goto done;
    }
    /* Apple's statx allocation retry can return zero with an unpopulated
     * filesec on allocation failure. Absence is meaningful only after these
     * mandatory properties prove that population completed. */
    result = complete_stat_properties(security, &status);
    if (result != AICHARTS_ACL_CLEAR) goto done;
    if (filesec_query_property(security, FILESEC_ACL, &present) != 0) {
        result = native_failure(errno);
        goto done;
    }
    if (present == 0) goto done;
    result = AICHARTS_ACL_UNAVAILABLE;
    if (filesec_get_property(security, FILESEC_ACL, &acl) != 0) {
        result = native_failure(errno);
        goto done;
    }
    if (acl == NULL || acl == (acl_t)_FILESEC_REMOVE_ACL) goto done;
    if (acl_valid(acl) != 0) {
        result = native_failure(errno);
        goto done;
    }
    /* Darwin returns zero for an entry, unlike Linux. With this fresh,
     * validated copy and fixed FIRST index, EINVAL means an empty ACL. */
    for (unsigned int index = 0; index <= ACL_MAX_ENTRIES; ++index) {
        entry = NULL;
        const int found = acl_get_entry(acl, index == 0 ? ACL_FIRST_ENTRY : ACL_NEXT_ENTRY, &entry);
        const int entry_error = errno;
        if (found == -1 && entry_error == EINVAL) {
            result = AICHARTS_ACL_CLEAR;
            break;
        }
        if (found != 0) { result = native_failure(entry_error); break; }
        if (entry == NULL || index == ACL_MAX_ENTRIES) { result = AICHARTS_ACL_UNAVAILABLE; break; }
        if (!deny_only) { result = AICHARTS_ACL_PRESENT; break; }
        acl_tag_t tag = ACL_UNDEFINED_TAG;
        if (acl_get_tag_type(entry, &tag) != 0) { result = native_failure(errno); break; }
        if (tag == ACL_EXTENDED_ALLOW) { result = AICHARTS_ACL_PRESENT; break; }
        if (tag != ACL_EXTENDED_DENY) { result = AICHARTS_ACL_UNAVAILABLE; break; }
    }
done:
    /* Capture/classify errors before cleanup, which may change errno. Entries
     * borrow storage from acl; only the owned ACL copy is freed. */
    if (acl != NULL && acl != (acl_t)_FILESEC_REMOVE_ACL && acl_free(acl) != 0)
        result = AICHARTS_ACL_UNAVAILABLE;
    filesec_free(security);
    return result;
}

int aicharts_macos_check_acl_fd(int fd) { return check_acl_fd(fd, 0); }
int aicharts_macos_check_deny_only_acl_fd(int fd) { return check_acl_fd(fd, 1); }
