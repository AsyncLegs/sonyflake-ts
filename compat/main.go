// Compat helper: generates Sonyflake IDs with sony/sonyflake and prints
// each ID together with its Decompose() result. The TS test consumes this
// to verify that our pure-TS port is bit-identical with the Go reference.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/sony/sonyflake"
)

func main() {
	machineID := flag.Uint("machine", 1234, "16-bit machine id")
	count := flag.Int("n", 64, "number of IDs to generate")
	startMs := flag.Int64("start-ms", 0, "epoch start in unix ms (0 = library default 2014-09-01 UTC)")
	flag.Parse()

	settings := sonyflake.Settings{
		MachineID: func() (uint16, error) { return uint16(*machineID), nil },
	}
	if *startMs > 0 {
		settings.StartTime = time.UnixMilli(*startMs).UTC()
	}

	sf, err := sonyflake.New(settings)
	if err != nil {
		fmt.Fprintln(os.Stderr, "init:", err)
		os.Exit(1)
	}

	// Header: tab-separated columns the TS test parses.
	fmt.Println("id\tmsb\ttime\tsequence\tmachine_id")
	for i := 0; i < *count; i++ {
		id, err := sf.NextID()
		if err != nil {
			fmt.Fprintln(os.Stderr, "next:", err)
			os.Exit(1)
		}
		parts := sonyflake.Decompose(id)
		fmt.Printf("%d\t%d\t%d\t%d\t%d\n",
			parts["id"], parts["msb"], parts["time"], parts["sequence"], parts["machine-id"])
	}
}
