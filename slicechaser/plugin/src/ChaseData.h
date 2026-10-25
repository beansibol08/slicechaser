// Chase file model, loader and the timing maths shared by the plugins.
// Nothing in here touches OpenGL, so it can be unit tested on any machine.
#pragma once
#include <string>
#include <vector>
#include <memory>
#include <mutex>
#include <chrono>
#include <cstdint>

namespace sc
{
// One Advanced Output slice, already triangulated by the editor.
// verts holds triangles: 3 vertices each, 4 floats per vertex:
//   x, y   position in the composition, 0..1, y pointing down
//   lu, lv position inside the slice's own frame, 0..1 (handles rotation)
struct Slice
{
	std::string name;
	float aspect = 1.0f;// width / height of the slice in pixels
	std::vector< float > verts;
};

struct Sequence
{
	int id = 0;// stable id, used as the option value so saved compositions survive renames/reorders
	std::string name;
	std::vector< std::vector< int > > steps;// each step lists slice indices that light up
};

struct ChaseFile
{
	int compWidth  = 0;
	int compHeight = 0;
	std::vector< Slice > slices;
	std::vector< Sequence > sequences;

	const Sequence* FindSequence( int id ) const;
};

bool ParseChaseJson( const std::string& text, ChaseFile& out, std::string& error );

// <Documents>/SliceChaser/chases.json, or $SLICECHASER_FILE when set.
std::string ChaseFilePath();

// Process-wide, hot-reloading view of the chase file. All plugin instances share it.
class ChaseLibrary
{
public:
	static ChaseLibrary& Get();

	// Re-reads the file if it changed on disk (checked at most twice a second).
	// Returns the current data (never null) and a revision number that changes on every reload.
	std::shared_ptr< const ChaseFile > Current( uint64_t* revision );

	// For tests: load from a specific path, bypassing the throttle.
	void ForceReload( const std::string& path );

private:
	ChaseLibrary();
	void PollLocked( bool force );

	std::mutex mutex;
	std::string path;
	std::shared_ptr< const ChaseFile > data;
	uint64_t revision = 0;
	long long lastStamp = -1;// mtime ^ size of the file we last loaded
	std::chrono::steady_clock::time_point lastPoll;
	bool polledOnce = false;
};

// Fade curve within one step window. t runs 0..1 through the window.
// Fully on until `sustain`, linear fade to 0 at `release`, off afterwards.
// release <= sustain gives a hard cut at `sustain`.
float Envelope( float t, float sustain, float release );

// Chaser: opacity for every slice given the Step position (0..1 across the whole sequence).
void ChaserOpacities( const Sequence& seq, size_t sliceCount, float step01, int echoes, float sustain, float release,
                      bool reverse, std::vector< float >& out );

// Bumper: tap-driven stepping with per-slice fade timers.
class BumperState
{
public:
	void Next( const Sequence& seq, size_t sliceCount, double now, bool autoReset, double resetDelay );
	void Previous( const Sequence& seq, size_t sliceCount, double now );
	void StartBlast( const Sequence& seq, double now );
	// Advances an active blast and returns per-slice opacities.
	void Update( const Sequence& seq, size_t sliceCount, double now, double blastInterval, double fadeSeconds, float sustain,
	             float release, std::vector< float >& out );
	void Reset();
	int CurrentStep() const
	{
		return current;
	}

private:
	void Fire( const Sequence& seq, size_t sliceCount, int step, double now );
	int current       = -1;
	double lastInput  = -1e9;
	int blastLeft     = 0;
	double nextBlast  = 0.0;
	std::vector< double > fired;// time each slice was last triggered
};

// Map 0..1 knobs to useful time ranges (exponential so the low end isn't cramped).
double FadeSecondsFromSpeed( float speed01 );// 0 -> 2 s, 1 -> 0.04 s
double BlastIntervalFromSpeed( float speed01 );// 0 -> 0.25 s, 1 -> 0.025 s

double NowSeconds();

}//namespace sc
