// Draws the slices of a chase file with per-slice opacity, sampling the effect's input.
#pragma once
#include <FFGLSDK.h>
#include <vector>
#include "ChaseData.h"

namespace sc
{
enum class Scaling
{
	Fill    = 0,// fit content into each slice, keep aspect, crop overflow
	Mask    = 1,// content stays put, slices act as holes
	Stretch = 2 // squash content into each slice
};

class SliceRenderer
{
public:
	bool InitGL();
	void DeInitGL();

	// Re-uploads geometry when the chase file changed. Cheap to call every frame.
	void Sync( const ChaseFile& file, uint64_t revision );

	// Renders into the currently bound framebuffer (the host's output).
	void Draw( const FFGLTextureStruct& input, const std::vector< float >& opacities, Scaling scaling );

	size_t SliceCount() const
	{
		return ranges.size();
	}

private:
	struct Range
	{
		GLint first;
		GLsizei count;
		float aspect;
	};
	ffglex::FFGLShader shader;
	GLuint vao        = 0;
	GLuint vbo        = 0;
	uint64_t uploaded = ~0ull;
	std::vector< Range > ranges;
};

}//namespace sc
