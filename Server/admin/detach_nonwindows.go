//go:build !windows

package admin

import "os/exec"

func setDetachedSysProcAttr(_ *exec.Cmd) {}

