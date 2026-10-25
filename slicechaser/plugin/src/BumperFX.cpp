// SliceBumper: tap Next/Previous to bump through a sequence by hand, or Blast through it.
#include "ChaseEffect.h"

namespace sc
{
class BumperFX : public ChaseEffect
{
public:
	enum : unsigned int
	{
		PID_NEXT = PID_FIRST_CUSTOM,
		PID_PREVIOUS,
		PID_BLAST,
		PID_BLAST_SPEED,
		PID_FADE_SPEED,
		PID_SUSTAIN,
		PID_RELEASE,
		PID_AUTO_RESET,
		PID_RESET_DELAY
	};

	BumperFX()
	{
		SetParamInfof( PID_NEXT, "Next", FF_TYPE_EVENT );
		SetParamInfof( PID_PREVIOUS, "Previous", FF_TYPE_EVENT );
		SetParamInfof( PID_BLAST, "Blast", FF_TYPE_EVENT );
		SetParamInfo( PID_BLAST_SPEED, "Blast Speed", FF_TYPE_STANDARD, blastSpeed );
		SetParamInfo( PID_FADE_SPEED, "Fade Speed", FF_TYPE_STANDARD, fadeSpeed );
		SetParamInfo( PID_SUSTAIN, "Sustain", FF_TYPE_STANDARD, sustain );
		SetParamInfo( PID_RELEASE, "Release", FF_TYPE_STANDARD, release );
		SetParamInfo( PID_AUTO_RESET, "Auto Reset", FF_TYPE_BOOLEAN, autoReset );
		SetParamInfo( PID_RESET_DELAY, "Reset Delay", FF_TYPE_STANDARD, resetDelay );
		SetParamRange( PID_RESET_DELAY, 0.5f, 10.0f );
	}

protected:
	void ComputeOpacities( const ChaseFile& file, const Sequence* seq, std::vector< float >& out ) override
	{
		const size_t n = file.slices.size();
		if( !seq )
		{
			pendingNext = pendingPrev = 0;
			pendingBlast             = false;
			out.assign( n, 0.0f );
			return;
		}
		// Button presses arrive between frames; apply them here where the sequence is known.
		double now = NowSeconds();
		for( ; pendingNext > 0; --pendingNext )
			state.Next( *seq, n, now, autoReset, resetDelay );
		for( ; pendingPrev > 0; --pendingPrev )
			state.Previous( *seq, n, now );
		if( pendingBlast )
		{
			state.StartBlast( *seq, now );
			pendingBlast = false;
		}
		state.Update( *seq, n, now, BlastIntervalFromSpeed( blastSpeed ), FadeSecondsFromSpeed( fadeSpeed ), sustain,
		              release, out );
	}

	void OnSequenceChanged() override
	{
		state.Reset();
	}

	FFResult SetCustomFloat( unsigned int index, float value ) override
	{
		const bool down = value > 0.5f;
		switch( index )
		{
		case PID_NEXT:
			if( down && !nextDown )
				++pendingNext;
			nextDown = down;
			break;
		case PID_PREVIOUS:
			if( down && !prevDown )
				++pendingPrev;
			prevDown = down;
			break;
		case PID_BLAST:
			if( down && !blastDown )
				pendingBlast = true;
			blastDown = down;
			break;
		case PID_BLAST_SPEED: blastSpeed = value; break;
		case PID_FADE_SPEED: fadeSpeed = value; break;
		case PID_SUSTAIN: sustain = value; break;
		case PID_RELEASE: release = value; break;
		case PID_AUTO_RESET: autoReset = down; break;
		case PID_RESET_DELAY: resetDelay = value; break;
		default: return FF_FAIL;
		}
		return FF_SUCCESS;
	}

	float GetCustomFloat( unsigned int index ) override
	{
		switch( index )
		{
		case PID_NEXT: return nextDown ? 1.0f : 0.0f;
		case PID_PREVIOUS: return prevDown ? 1.0f : 0.0f;
		case PID_BLAST: return blastDown ? 1.0f : 0.0f;
		case PID_BLAST_SPEED: return blastSpeed;
		case PID_FADE_SPEED: return fadeSpeed;
		case PID_SUSTAIN: return sustain;
		case PID_RELEASE: return release;
		case PID_AUTO_RESET: return autoReset ? 1.0f : 0.0f;
		case PID_RESET_DELAY: return resetDelay;
		default: return 0.0f;
		}
	}

private:
	BumperState state;
	int pendingNext   = 0;
	int pendingPrev   = 0;
	bool pendingBlast = false;
	bool nextDown = false, prevDown = false, blastDown = false;
	float blastSpeed = 0.5f;
	float fadeSpeed  = 0.5f;
	float sustain    = 0.2f;
	float release    = 0.8f;
	bool autoReset   = true;
	float resetDelay = 2.0f;
};

}//namespace sc

static CFFGLPluginInfo PluginInfo(
	PluginFactory< sc::BumperFX >,
	"SCbu",
	"SliceBumper",
	2,
	1,
	1,
	0,
	FF_EFFECT,
	"Tap through Advanced Output slices by hand",
	"SliceChaser" );
